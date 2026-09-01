'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const visitPayments = require('./restaurant-visit-payments.service');
const identity = require('./restaurant-identity.service');

const ORIGIN_TYPE = 'RESTAURANT_ACCOUNT_REQUEST';
const PRIMARY_ONLY_MS = 20_000;
const REQUEST_TTL_MS = 12 * 60 * 60 * 1000;
const SHARED_WAITER_ROLE = 'MESERO_OPERATIVO_COMPARTIDO';

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function latestMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === 'ACCOUNT_REQUEST_CREATED') || null;
}

async function activeWaiter(tenantId, userId, client = prisma) {
  if (!userId) return null;
  return client.user.findFirst({
    where: { id:userId, tenantId, activo:true, rol:'MESERO' },
    select: { id:true, nombre:true, rol:true }
  });
}

async function resolvePrimaryWaiter(verified, client = prisma) {
  const openedBy = await activeWaiter(verified.table.tenantId, verified.session.openedByUserId, client);
  if (openedBy) return openedBy;
  return activeWaiter(verified.table.tenantId, verified.table.assignedWaiterId, client);
}

function statusFromSession(session) {
  if (!session) return { state:'CLOSED', requested:false, requestedAt:null, preparedAt:null, cashierRequestedAt:null };
  if (session.cashierRequestedAt) return { state:'IN_CASH', requested:true, requestedAt:session.accountRequestedAt, preparedAt:session.accountPreparedAt, cashierRequestedAt:session.cashierRequestedAt };
  if (session.accountPreparedAt) return { state:'PREPARING', requested:true, requestedAt:session.accountRequestedAt, preparedAt:session.accountPreparedAt, cashierRequestedAt:null };
  if (session.accountRequestedAt || session.state === 'CUENTA_PEDIDA') return { state:'REQUESTED', requested:true, requestedAt:session.accountRequestedAt, preparedAt:null, cashierRequestedAt:null };
  return { state:'OPEN', requested:false, requestedAt:null, preparedAt:null, cashierRequestedAt:null };
}

function isEscalated(row, now = new Date()) {
  const meta = latestMeta(row) || {};
  if (!meta.primaryWaiterId) return true;
  if (row.currentStatus === 'ESCALATED') return true;
  const at = new Date(meta.escalatesAt || 0).getTime();
  return Number.isFinite(at) && at <= now.getTime();
}

async function ensureEscalated(row, now = new Date()) {
  if (!row?.active || row.currentStatus !== 'PENDING_PRIMARY' || !isEscalated(row, now)) return row;
  const timeline = [...timelineArray(row.timeline), { type:'ACCOUNT_REQUEST_ESCALATED', at:now.toISOString() }];
  const changed = await prisma.trackingLink.updateMany({
    where: { id:row.id, active:true, currentStatus:'PENDING_PRIMARY' },
    data: { currentStatus:'ESCALATED', timeline, lastNotificationAt:now }
  });
  if (changed.count !== 1) return prisma.trackingLink.findUnique({ where:{ id:row.id } });
  return prisma.trackingLink.findUnique({ where:{ id:row.id } });
}

async function ensureConsumption(tenantId, sessionId, client = prisma) {
  const order = await client.restaurantOrder.findFirst({
    where: { tenantId, sessionId, state:{ not:'CANCELADO' } },
    select: { id:true }
  });
  if (!order) throw new AppError(409, 'Aún no hay consumos para pedir la cuenta', 'RESTAURANT_ACCOUNT_REQUEST_EMPTY');
  const item = await client.restaurantOrderItem.findFirst({
    where: { tenantId, orderId:order.id },
    select: { id:true }
  });
  if (!item) throw new AppError(409, 'Aún no hay consumos para pedir la cuenta', 'RESTAURANT_ACCOUNT_REQUEST_EMPTY');
}

async function currentLink(tenantId, sessionId) {
  return prisma.trackingLink.findFirst({
    where: {
      tenantId,
      originType:ORIGIN_TYPE,
      originId:sessionId,
      active:true,
      currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] },
      expiresAt:{ gt:new Date() }
    }
  });
}

async function createRequest(qrToken, rawVisitToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  const existingStatus = statusFromSession(verified.session);
  if (existingStatus.state !== 'OPEN') return { ...existingStatus, table:{ id:verified.table.id, code:verified.table.code, name:verified.table.name } };

  await ensureConsumption(verified.table.tenantId, verified.session.id);
  const primary = await resolvePrimaryWaiter(verified);
  const now = new Date();
  const escalatesAt = new Date(now.getTime() + (primary ? PRIMARY_ONLY_MS : 0));

  await prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { id:verified.session.id, tenantId:verified.table.tenantId, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } }
    });
    if (!session) throw new AppError(409, 'La mesa ya no tiene una visita activa', 'RESTAURANT_QR_TABLE_NOT_OPEN');
    if (!session.accountRequestedAt && !session.accountPreparedAt && !session.cashierRequestedAt) {
      await tx.restaurantTableSession.update({
        where: { id:session.id },
        data: { state:'CUENTA_PEDIDA', accountRequestedAt:now }
      });
      await tx.restaurantTable.update({ where:{ id:verified.table.id }, data:{ state:'CUENTA_PEDIDA' } });
    }

    const raw = crypto.randomBytes(32).toString('base64url');
    const event = {
      type:'ACCOUNT_REQUEST_CREATED',
      at:now.toISOString(),
      sessionId:session.id,
      tableId:verified.table.id,
      tableCode:verified.table.code,
      tableName:verified.table.name,
      seatNumber:verified.device.seatNumber || null,
      qrVisitDeviceId:verified.device.id,
      primaryWaiterId:primary?.id || null,
      escalatesAt:escalatesAt.toISOString()
    };
    await tx.trackingLink.upsert({
      where: { tenantId_originType_originId:{ tenantId:verified.table.tenantId, originType:ORIGIN_TYPE, originId:session.id } },
      create: {
        tenantId:verified.table.tenantId,
        tokenHash:crypto.createHash('sha256').update(raw).digest('hex'),
        tokenCiphertext:`ACCOUNT_REQUEST:${session.id}`,
        tokenHint:raw.slice(-6),
        originType:ORIGIN_TYPE,
        originId:session.id,
        publicReference:primary?.id || 'ALL',
        currentStatus:primary ? 'PENDING_PRIMARY' : 'ESCALATED',
        timeline:[event],
        expiresAt:new Date(now.getTime() + REQUEST_TTL_MS),
        active:true,
        completedAt:null,
        lastNotificationAt:now,
        createdByUserId:null
      },
      update: {
        publicReference:primary?.id || 'ALL',
        currentStatus:primary ? 'PENDING_PRIMARY' : 'ESCALATED',
        timeline:[event],
        expiresAt:new Date(now.getTime() + REQUEST_TTL_MS),
        active:true,
        completedAt:null,
        lastNotificationAt:now
      }
    });
  });

  return {
    state:'REQUESTED', requested:true, requestedAt:now, preparedAt:null, cashierRequestedAt:null,
    table:{ id:verified.table.id, code:verified.table.code, name:verified.table.name }
  };
}

async function clientStatus(qrToken, rawVisitToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  return { ...statusFromSession(verified.session), table:{ id:verified.table.id, code:verified.table.code, name:verified.table.name } };
}

async function waiterRequestsSnapshot(tenantId, waiterUserId) {
  const waiter = await activeWaiter(tenantId, waiterUserId);
  if (!waiter) throw new AppError(403, 'Sólo un mesero activo puede atender solicitudes de cuenta', 'RESTAURANT_ACCOUNT_REQUEST_FORBIDDEN');
  const now = new Date();
  let rows = await prisma.trackingLink.findMany({
    where: {
      tenantId,
      originType:ORIGIN_TYPE,
      active:true,
      currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] },
      expiresAt:{ gt:now }
    },
    orderBy:{ creadoEn:'asc' },
    take:100
  });
  const sessionIds = [...new Set(rows.map((row) => row.originId))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id:{ in:sessionIds }, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    include:{ table:true }
  }) : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));

  const stale = rows.filter((row) => {
    const session = byId.get(row.originId);
    return !session || session.accountPreparedAt || session.cashierRequestedAt || !session.accountRequestedAt;
  });
  if (stale.length) {
    await prisma.trackingLink.updateMany({
      where:{ id:{ in:stale.map((row) => row.id) }, active:true },
      data:{ active:false, currentStatus:'CLOSED', completedAt:now }
    }).catch(() => {});
    rows = rows.filter((row) => !stale.some((staleRow) => staleRow.id === row.id));
  }

  const normalized = [];
  for (const row of rows) normalized.push(await ensureEscalated(row, now));
  return normalized.filter(Boolean).filter((row) => {
    const meta = latestMeta(row) || {};
    return meta.primaryWaiterId === waiterUserId || isEscalated(row, now);
  }).map((row) => {
    const meta = latestMeta(row) || {};
    return {
      id:row.id,
      sessionId:row.originId,
      state:isEscalated(row, now) ? 'ESCALATED' : 'PENDING_PRIMARY',
      priority:meta.primaryWaiterId === waiterUserId ? 'PRIMARY' : 'GENERAL',
      escalated:isEscalated(row, now),
      createdAt:meta.at || row.creadoEn,
      escalatesAt:meta.escalatesAt || null,
      table:{ id:meta.tableId || null, code:meta.tableCode || null, name:meta.tableName || null },
      seatNumber:meta.seatNumber || null
    };
  });
}

async function attendRequest(tenantId, waiterUserId, requestId) {
  const waiter = await activeWaiter(tenantId, waiterUserId);
  if (!waiter) throw new AppError(403, 'Sólo un mesero activo puede atender solicitudes de cuenta', 'RESTAURANT_ACCOUNT_REQUEST_FORBIDDEN');
  let row = await prisma.trackingLink.findFirst({ where:{ id:requestId, tenantId, originType:ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Solicitud de cuenta no encontrada', 'RESTAURANT_ACCOUNT_REQUEST_NOT_FOUND');
  if (!row.active || !['PENDING_PRIMARY','ESCALATED'].includes(row.currentStatus)) {
    return { attended:true, alreadyAttended:true, requestId:row.id };
  }
  row = await ensureEscalated(row);
  const meta = latestMeta(row) || {};
  if (!isEscalated(row) && meta.primaryWaiterId !== waiterUserId) {
    throw new AppError(403, 'Esta cuenta todavía corresponde al mesero que abrió la atención', 'RESTAURANT_ACCOUNT_REQUEST_PRIMARY_ONLY');
  }

  const session = await prisma.restaurantTableSession.findFirst({
    where:{ id:row.originId, tenantId, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    include:{ table:true }
  });
  if (!session) throw new AppError(409, 'La mesa ya no tiene una visita activa', 'RESTAURANT_ACCOUNT_REQUEST_TABLE_CLOSED');
  if (!session.accountPreparedAt) {
    await identity.prepareAccount(tenantId, { ...waiter, rol:SHARED_WAITER_ROLE }, session.tableId);
  }

  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type:'ACCOUNT_REQUEST_ATTENDED', at:now.toISOString(), waiterUserId, waiterName:waiter.nombre || null }];
  await prisma.trackingLink.updateMany({
    where:{ id:row.id, tenantId, active:true },
    data:{ active:false, currentStatus:'ATTENDED', completedAt:now, lastNotificationAt:now, timeline }
  });
  return { attended:true, alreadyAttended:false, requestId:row.id, tableId:session.tableId, sessionId:session.id };
}

module.exports = {
  ORIGIN_TYPE,
  PRIMARY_ONLY_MS,
  createRequest,
  clientStatus,
  waiterRequestsSnapshot,
  attendRequest,
  statusFromSession
};
