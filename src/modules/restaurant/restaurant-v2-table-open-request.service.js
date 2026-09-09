'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const restaurant = require('./restaurant.service');
const realtime = require('../realtime/tenant-realtime.service');

const ORIGIN_TYPE = 'RESTAURANT_TABLE_OPEN_REQUEST_V2';
const REQUEST_TTL_MS = 30 * 60 * 1000;
const V2_OPTIONS = Object.freeze({ sharedFloor:true, optionalSeat:true });

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function latestRequestMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === 'OPEN_REQUEST_CREATED') || null;
}

async function tableByQr(qrToken, client = prisma) {
  const table = await client.restaurantTable.findUnique({ where:{ qrToken } });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  return table;
}

async function currentSession(tenantId, tableId, client = prisma) {
  return client.restaurantTableSession.findFirst({
    where:{ tenantId, tableId, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    orderBy:{ openedAt:'desc' }
  });
}

function publicRequest(row, table) {
  const meta = latestRequestMeta(row) || {};
  return {
    id:row.id,
    state:row.currentStatus,
    requested:true,
    createdAt:meta.at || row.creadoEn,
    expiresAt:row.expiresAt,
    table:{ id:table.id, code:table.code, name:table.name, zoneId:table.zoneId || null }
  };
}

async function publish(tenantId, tableId, requestId, action) {
  await realtime.publishTenantChange(
    tenantId,
    ['restaurant.table-open-request','restaurant.tables'],
    { tableId, requestId },
    { source:'restaurant-v2-table-open-request', method:'POST', path:action }
  ).catch(() => {});
}

async function createRequest(qrToken) {
  const table = await tableByQr(qrToken);
  const open = await currentSession(table.tenantId, table.id);
  if (open) return { requested:false, open:true, sessionId:open.id, table:{ id:table.id, code:table.code, name:table.name } };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
  const tokenSeed = crypto.randomBytes(32).toString('base64url');
  const event = {
    type:'OPEN_REQUEST_CREATED',
    at:now.toISOString(),
    tableId:table.id,
    tableCode:table.code,
    tableName:table.name,
    zoneId:table.zoneId || null
  };
  const data = {
    tokenHash:crypto.createHash('sha256').update(tokenSeed).digest('hex'),
    tokenCiphertext:`TABLE_OPEN_REQUEST:${table.id}`,
    tokenHint:tokenSeed.slice(-6),
    publicReference:table.id,
    currentStatus:'PENDING',
    timeline:[event],
    expiresAt,
    completedAt:null,
    active:true,
    lastNotificationAt:now,
    createdByUserId:null
  };

  let row;
  try {
    row = await prisma.trackingLink.upsert({
      where:{ tenantId_originType_originId:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id } },
      create:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id, ...data },
      update:data
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    row = await prisma.trackingLink.findFirst({ where:{ tenantId:table.tenantId, originType:ORIGIN_TYPE, originId:table.id } });
    if (!row) throw error;
  }

  await publish(table.tenantId, table.id, row.id, '/solicitar-apertura');
  return publicRequest(row, table);
}

async function closeStaleRequests(tenantId, rows) {
  if (!rows.length) return rows;
  const tableIds = [...new Set(rows.map((row) => row.originId).filter(Boolean))];
  const sessions = tableIds.length ? await prisma.restaurantTableSession.findMany({
    where:{ tenantId, tableId:{ in:tableIds }, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    select:{ tableId:true }
  }) : [];
  const openIds = new Set(sessions.map((row) => row.tableId));
  const stale = rows.filter((row) => openIds.has(row.originId));
  if (stale.length) {
    const now = new Date();
    await prisma.trackingLink.updateMany({
      where:{ id:{ in:stale.map((row) => row.id) }, tenantId, active:true },
      data:{ active:false, currentStatus:'OPENED', completedAt:now }
    }).catch(() => {});
  }
  return rows.filter((row) => !openIds.has(row.originId));
}

async function listPending(tenantId) {
  const now = new Date();
  let rows = await prisma.trackingLink.findMany({
    where:{ tenantId, originType:ORIGIN_TYPE, active:true, currentStatus:'PENDING', expiresAt:{ gt:now } },
    orderBy:{ creadoEn:'asc' },
    take:100
  });
  rows = await closeStaleRequests(tenantId, rows);
  if (!rows.length) return { requests:[] };
  const tableIds = [...new Set(rows.map((row) => row.originId))];
  const tables = await prisma.restaurantTable.findMany({
    where:{ tenantId, id:{ in:tableIds }, active:true },
    select:{ id:true, code:true, name:true, zoneId:true, assignedWaiterId:true, state:true }
  });
  const byId = new Map(tables.map((table) => [table.id, table]));
  return { requests:rows.map((row) => byId.has(row.originId) ? publicRequest(row, byId.get(row.originId)) : null).filter(Boolean) };
}

async function resolveRequest(tenantId, requestId) {
  const row = await prisma.trackingLink.findFirst({
    where:{ id:requestId, tenantId, originType:ORIGIN_TYPE, active:true, currentStatus:'PENDING', expiresAt:{ gt:new Date() } }
  });
  if (!row) throw new AppError(404, 'La solicitud de apertura ya no está activa', 'RESTAURANT_TABLE_OPEN_REQUEST_NOT_FOUND');
  const table = await prisma.restaurantTable.findFirst({ where:{ id:row.originId, tenantId, active:true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  return { row, table };
}

async function openRequestedTable(tenantId, user, requestId, guestCount = 1) {
  const { row, table } = await resolveRequest(tenantId, requestId);
  let opened;
  const existing = await currentSession(tenantId, table.id);
  if (existing) {
    opened = { table:{ ...table, state:'OCUPADA' }, session:existing, alreadyOpen:true };
  } else {
    opened = await restaurant.openTable(tenantId, user, table.id, { guestCount }, V2_OPTIONS);
  }
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type:'OPEN_REQUEST_ACCEPTED', at:now.toISOString(), userId:user.id, sessionId:opened.session.id }];
  await prisma.trackingLink.updateMany({
    where:{ id:row.id, tenantId, active:true },
    data:{ active:false, currentStatus:'OPENED', completedAt:now, lastNotificationAt:now, timeline }
  });
  await publish(tenantId, table.id, row.id, '/v2/solicitudes-apertura/:id/abrir');
  return { requestId:row.id, opened:true, alreadyOpen:Boolean(existing), table:opened.table, session:opened.session, sale:opened.sale || null };
}

async function dismissRequest(tenantId, user, requestId) {
  const { row, table } = await resolveRequest(tenantId, requestId);
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type:'OPEN_REQUEST_DISMISSED', at:now.toISOString(), userId:user.id }];
  await prisma.trackingLink.update({
    where:{ id:row.id },
    data:{ active:false, currentStatus:'DISMISSED', completedAt:now, lastNotificationAt:now, timeline }
  });
  await publish(tenantId, table.id, row.id, '/v2/solicitudes-apertura/:id/descartar');
  return { requestId:row.id, dismissed:true, table:{ id:table.id, code:table.code, name:table.name } };
}

module.exports = {
  ORIGIN_TYPE,
  REQUEST_TTL_MS,
  createRequest,
  listPending,
  openRequestedTable,
  dismissRequest
};
