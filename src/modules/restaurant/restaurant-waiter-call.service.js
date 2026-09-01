'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const visitPayments = require('./restaurant-visit-payments.service');

const ORIGIN_TYPE = 'RESTAURANT_WAITER_CALL';
const PRIMARY_ONLY_MS = 20_000;
const CALL_TTL_MS = 12 * 60 * 60 * 1000;

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function latestCallMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === 'CALL_CREATED') || null;
}

async function audit(tenantId, actorType, actorId, action, entityId, metadata = null, client = prisma) {
  return client.notificationAudit.create({
    data: {
      tenantId,
      actorType,
      actorId: actorId || null,
      action,
      entity: 'RestaurantWaiterCall',
      entityId: entityId || null,
      metadata
    }
  });
}

async function activeWaiter(tenantId, userId, client = prisma) {
  if (!userId) return null;
  return client.user.findFirst({
    where: { id: userId, tenantId, activo: true, rol: 'MESERO' },
    select: { id: true, nombre: true, rol: true }
  });
}

async function resolvePrimaryWaiter(verified, client = prisma) {
  const openedBy = await activeWaiter(verified.table.tenantId, verified.session.openedByUserId, client);
  if (openedBy) return openedBy;

  const firstWaiterOrder = await client.restaurantOrder.findFirst({
    where: {
      tenantId: verified.table.tenantId,
      sessionId: verified.session.id,
      source: 'MESERO',
      createdByUserId: { not: null }
    },
    select: { createdByUserId: true },
    orderBy: { creadoEn: 'asc' }
  });
  const orderWaiter = await activeWaiter(verified.table.tenantId, firstWaiterOrder?.createdByUserId, client);
  if (orderWaiter) return orderWaiter;

  return activeWaiter(verified.table.tenantId, verified.table.assignedWaiterId, client);
}

function isEscalated(row, now = new Date()) {
  const meta = latestCallMeta(row);
  if (!meta?.primaryWaiterId) return true;
  if (row.currentStatus === 'ESCALATED') return true;
  const at = new Date(meta.escalatesAt || 0).getTime();
  return Number.isFinite(at) && at <= now.getTime();
}

async function ensureEscalated(row, now = new Date()) {
  if (!row?.active || row.currentStatus !== 'PENDING_PRIMARY' || !isEscalated(row, now)) return row;
  const meta = latestCallMeta(row);
  const nextTimeline = [...timelineArray(row.timeline), { type: 'CALL_ESCALATED', at: now.toISOString() }];
  const changed = await prisma.trackingLink.updateMany({
    where: { id: row.id, active: true, currentStatus: 'PENDING_PRIMARY' },
    data: { currentStatus: 'ESCALATED', timeline: nextTimeline, lastNotificationAt: now }
  });
  if (changed.count === 1) {
    await audit(row.tenantId, 'SYSTEM', null, 'WAITER_CALL_ESCALATED', row.id, {
      sessionId: row.originId,
      primaryWaiterId: meta?.primaryWaiterId || null
    }).catch(() => {});
  }
  return prisma.trackingLink.findUnique({ where: { id: row.id } });
}

function publicCall(row) {
  if (!row?.active || !['PENDING_PRIMARY', 'ESCALATED'].includes(row.currentStatus)) return { active: false, call: null };
  const meta = latestCallMeta(row) || {};
  return {
    active: true,
    call: {
      id: row.id,
      state: row.currentStatus,
      createdAt: meta.at || row.creadoEn,
      escalatesAt: meta.escalatesAt || null,
      table: {
        id: meta.tableId || null,
        code: meta.tableCode || null,
        name: meta.tableName || null
      },
      seatNumber: meta.seatNumber || null
    }
  };
}

function waiterCall(row, waiterUserId, now = new Date()) {
  const meta = latestCallMeta(row) || {};
  const escalated = isEscalated(row, now);
  return {
    id: row.id,
    state: escalated ? 'ESCALATED' : 'PENDING_PRIMARY',
    priority: meta.primaryWaiterId === waiterUserId ? 'PRIMARY' : 'GENERAL',
    escalated,
    createdAt: meta.at || row.creadoEn,
    escalatesAt: meta.escalatesAt || null,
    table: {
      id: meta.tableId || null,
      code: meta.tableCode || null,
      name: meta.tableName || null
    },
    seatNumber: meta.seatNumber || null
  };
}

async function currentRow(tenantId, sessionId) {
  const row = await prisma.trackingLink.findFirst({
    where: {
      tenantId,
      originType: ORIGIN_TYPE,
      originId: sessionId,
      active: true,
      currentStatus: { in: ['PENDING_PRIMARY', 'ESCALATED'] },
      expiresAt: { gt: new Date() }
    }
  });
  return row ? ensureEscalated(row) : null;
}

async function sessionCallSnapshot(tenantId, sessionId) {
  const row = await currentRow(tenantId, sessionId);
  return publicCall(row);
}

async function createCall(qrToken, rawVisitToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  const existing = await currentRow(verified.table.tenantId, verified.session.id);
  if (existing) return publicCall(existing);

  const primary = await resolvePrimaryWaiter(verified);
  const now = new Date();
  const escalatesAt = new Date(now.getTime() + (primary ? PRIMARY_ONLY_MS : 0));
  const event = {
    type: 'CALL_CREATED',
    at: now.toISOString(),
    sessionId: verified.session.id,
    tableId: verified.table.id,
    tableCode: verified.table.code,
    tableName: verified.table.name,
    seatNumber: verified.device.seatNumber || null,
    qrVisitDeviceId: verified.device.id,
    primaryWaiterId: primary?.id || null,
    escalatesAt: escalatesAt.toISOString()
  };
  const tokenSeed = crypto.randomBytes(32).toString('base64url');
  const data = {
    tokenHash: crypto.createHash('sha256').update(tokenSeed).digest('hex'),
    tokenCiphertext: `WAITER_CALL:${verified.session.id}`,
    tokenHint: tokenSeed.slice(-6),
    publicReference: primary?.id || 'ALL',
    currentStatus: primary ? 'PENDING_PRIMARY' : 'ESCALATED',
    timeline: [event],
    expiresAt: new Date(now.getTime() + CALL_TTL_MS),
    completedAt: null,
    active: true,
    lastNotificationAt: now,
    createdByUserId: null
  };

  let row;
  try {
    row = await prisma.trackingLink.upsert({
      where: {
        tenantId_originType_originId: {
          tenantId: verified.table.tenantId,
          originType: ORIGIN_TYPE,
          originId: verified.session.id
        }
      },
      create: {
        tenantId: verified.table.tenantId,
        originType: ORIGIN_TYPE,
        originId: verified.session.id,
        ...data
      },
      update: data
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    row = await currentRow(verified.table.tenantId, verified.session.id);
    if (!row) throw error;
  }

  await audit(verified.table.tenantId, 'CUSTOMER_DEVICE', verified.device.id, 'WAITER_CALL_CREATED', row.id, {
    sessionId: verified.session.id,
    tableId: verified.table.id,
    primaryWaiterId: primary?.id || null,
    escalatesAt: escalatesAt.toISOString()
  }).catch(() => {});

  return publicCall(row);
}

async function clientCallSnapshot(qrToken, rawVisitToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  return sessionCallSnapshot(verified.table.tenantId, verified.session.id);
}

async function assertWaiter(tenantId, waiterUserId) {
  const waiter = await activeWaiter(tenantId, waiterUserId);
  if (!waiter) throw new AppError(403, 'Sólo un mesero activo puede atender llamados', 'RESTAURANT_WAITER_CALL_FORBIDDEN');
  return waiter;
}

async function waiterCallsSnapshot(tenantId, waiterUserId) {
  await assertWaiter(tenantId, waiterUserId);
  const now = new Date();
  let rows = await prisma.trackingLink.findMany({
    where: {
      tenantId,
      originType: ORIGIN_TYPE,
      active: true,
      currentStatus: { in: ['PENDING_PRIMARY', 'ESCALATED'] },
      expiresAt: { gt: now }
    },
    orderBy: { creadoEn: 'asc' },
    take: 100
  });

  const sessionIds = [...new Set(rows.map((row) => row.originId))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: sessionIds }, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    select: { id: true }
  }) : [];
  const openSessions = new Set(sessions.map((row) => row.id));
  const stale = rows.filter((row) => !openSessions.has(row.originId));
  if (stale.length) {
    const staleIds = stale.map((row) => row.id);
    await prisma.trackingLink.updateMany({
      where: { id: { in: staleIds }, active: true },
      data: { active: false, currentStatus: 'CLOSED', completedAt: now }
    }).catch(() => {});
    rows = rows.filter((row) => openSessions.has(row.originId));
  }

  const normalized = [];
  for (const row of rows) normalized.push(await ensureEscalated(row, now));
  const calls = normalized
    .filter(Boolean)
    .filter((row) => {
      const meta = latestCallMeta(row) || {};
      return meta.primaryWaiterId === waiterUserId || isEscalated(row, now);
    })
    .map((row) => waiterCall(row, waiterUserId, now));

  return { calls };
}

async function attendCall(tenantId, waiterUserId, callId) {
  const waiter = await assertWaiter(tenantId, waiterUserId);
  let row = await prisma.trackingLink.findFirst({
    where: { id: callId, tenantId, originType: ORIGIN_TYPE }
  });
  if (!row) throw new AppError(404, 'Llamado no encontrado', 'RESTAURANT_WAITER_CALL_NOT_FOUND');
  if (!row.active || !['PENDING_PRIMARY', 'ESCALATED'].includes(row.currentStatus)) {
    return { attended: true, alreadyAttended: true, callId: row.id };
  }

  const session = await prisma.restaurantTableSession.findFirst({
    where: { id: row.originId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    select: { id: true }
  });
  if (!session) throw new AppError(409, 'La mesa ya no tiene una visita activa', 'RESTAURANT_WAITER_CALL_TABLE_CLOSED');

  row = await ensureEscalated(row);
  const meta = latestCallMeta(row) || {};
  if (!isEscalated(row) && meta.primaryWaiterId !== waiterUserId) {
    throw new AppError(403, 'Este llamado todavía corresponde al mesero que abrió la atención', 'RESTAURANT_WAITER_CALL_PRIMARY_ONLY');
  }

  const now = new Date();
  const timeline = [...timelineArray(row.timeline), {
    type: 'CALL_ATTENDED',
    at: now.toISOString(),
    waiterUserId,
    waiterName: waiter.nombre || null
  }];
  const changed = await prisma.trackingLink.updateMany({
    where: {
      id: row.id,
      tenantId,
      active: true,
      currentStatus: { in: ['PENDING_PRIMARY', 'ESCALATED'] }
    },
    data: {
      active: false,
      currentStatus: 'ATTENDED',
      completedAt: now,
      lastNotificationAt: now,
      timeline
    }
  });
  if (changed.count !== 1) return { attended: true, alreadyAttended: true, callId: row.id };

  await audit(tenantId, 'USER', waiterUserId, 'WAITER_CALL_ATTENDED', row.id, {
    sessionId: row.originId,
    tableId: meta.tableId || null,
    primaryWaiterId: meta.primaryWaiterId || null
  }).catch(() => {});

  return { attended: true, alreadyAttended: false, callId: row.id, tableId: meta.tableId || null };
}

module.exports = {
  ORIGIN_TYPE,
  PRIMARY_ONLY_MS,
  CALL_TTL_MS,
  latestCallMeta,
  isEscalated,
  createCall,
  clientCallSnapshot,
  sessionCallSnapshot,
  waiterCallsSnapshot,
  attendCall
};
