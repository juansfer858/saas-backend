'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const baseCalls = require('./restaurant-waiter-call.service');

const STAFF_ROLES = new Set(['MESERO', 'ADMIN', 'SUPER_ADMIN', 'ADMINISTRADOR']);

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

async function activeStaff(tenantId, userId, client = prisma) {
  if (!userId) return null;
  const user = await client.user.findFirst({
    where: { id:userId, tenantId, activo:true },
    select: { id:true, nombre:true, rol:true }
  });
  return user && STAFF_ROLES.has(String(user.rol || '').toUpperCase()) ? user : null;
}

async function assertStaff(tenantId, userId) {
  const user = await activeStaff(tenantId, userId);
  if (!user) throw new AppError(403, 'Esta pantalla no puede atender llamados de mesa', 'RESTAURANT_WAITER_CALL_STAFF_FORBIDDEN');
  return user;
}

function callView(row, actorId, now = new Date()) {
  const meta = baseCalls.latestCallMeta(row) || {};
  const escalated = baseCalls.isEscalated(row, now);
  return {
    id:row.id,
    state:escalated ? 'ESCALATED' : 'PENDING_PRIMARY',
    priority:meta.primaryWaiterId === actorId ? 'PRIMARY' : 'GENERAL',
    escalated,
    createdAt:meta.at || row.creadoEn,
    escalatesAt:meta.escalatesAt || null,
    table:{ id:meta.tableId || null, code:meta.tableCode || null, name:meta.tableName || null },
    seatNumber:meta.seatNumber || null
  };
}

async function waiterCallsSnapshot(tenantId, actorId) {
  await assertStaff(tenantId, actorId);
  const now = new Date();
  let rows = await prisma.trackingLink.findMany({
    where: {
      tenantId,
      originType:baseCalls.ORIGIN_TYPE,
      active:true,
      currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] },
      expiresAt:{ gt:now }
    },
    orderBy:{ creadoEn:'asc' },
    take:100
  });
  const sessionIds = [...new Set(rows.map((row) => row.originId))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where:{ tenantId, id:{ in:sessionIds }, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    select:{ id:true }
  }) : [];
  const open = new Set(sessions.map((row) => row.id));
  const stale = rows.filter((row) => !open.has(row.originId));
  if (stale.length) {
    await prisma.trackingLink.updateMany({
      where:{ id:{ in:stale.map((row) => row.id) }, active:true },
      data:{ active:false, currentStatus:'CLOSED', completedAt:now }
    }).catch(() => {});
    rows = rows.filter((row) => open.has(row.originId));
  }
  return { calls:rows.map((row) => callView(row, actorId, now)) };
}

async function attendCall(tenantId, actorId, callId) {
  const actor = await assertStaff(tenantId, actorId);
  const row = await prisma.trackingLink.findFirst({
    where:{ id:callId, tenantId, originType:baseCalls.ORIGIN_TYPE }
  });
  if (!row) throw new AppError(404, 'Llamado no encontrado', 'RESTAURANT_WAITER_CALL_NOT_FOUND');
  if (!row.active || !['PENDING_PRIMARY','ESCALATED'].includes(row.currentStatus)) {
    return { attended:true, alreadyAttended:true, callId:row.id };
  }
  const session = await prisma.restaurantTableSession.findFirst({
    where:{ id:row.originId, tenantId, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    select:{ id:true }
  });
  if (!session) throw new AppError(409, 'La mesa ya no tiene una visita activa', 'RESTAURANT_WAITER_CALL_TABLE_CLOSED');

  const meta = baseCalls.latestCallMeta(row) || {};
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), {
    type:'CALL_ATTENDED', at:now.toISOString(), waiterUserId:actorId, waiterName:actor.nombre || null,
    reinforced:meta.primaryWaiterId && meta.primaryWaiterId !== actorId
  }];
  const changed = await prisma.trackingLink.updateMany({
    where:{ id:row.id, tenantId, active:true, currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] } },
    data:{ active:false, currentStatus:'ATTENDED', completedAt:now, lastNotificationAt:now, timeline }
  });
  if (changed.count !== 1) return { attended:true, alreadyAttended:true, callId:row.id };
  await prisma.notificationAudit.create({
    data:{
      tenantId, actorType:'USER', actorId, action:'WAITER_CALL_ATTENDED', entity:'RestaurantWaiterCall', entityId:row.id,
      metadata:{ sessionId:row.originId, tableId:meta.tableId || null, primaryWaiterId:meta.primaryWaiterId || null, actorRole:actor.rol }
    }
  }).catch(() => {});
  return { attended:true, alreadyAttended:false, callId:row.id, tableId:meta.tableId || null };
}

module.exports = { STAFF_ROLES, activeStaff, waiterCallsSnapshot, attendCall };
