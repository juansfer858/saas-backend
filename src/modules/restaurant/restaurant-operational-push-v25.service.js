'use strict';

const { prisma } = require('../../config/prisma');
const push = require('../notifications/push-v65.service');

const ADMIN_ROLES = Object.freeze(['ADMIN','SUPER_ADMIN','ADMINISTRADOR']);
const WAITER_CALL_ORIGIN = 'RESTAURANT_WAITER_CALL';
const ACCOUNT_REQUEST_ORIGIN = 'RESTAURANT_ACCOUNT_REQUEST';

function text(value) {
  return String(value || '').trim();
}

function tableLabel(table) {
  return text(table?.code) || text(table?.name) || 'Mesa';
}

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function latestTimeline(row, type) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === type) || null;
}

function eventSuffix(value) {
  const raw = text(value);
  return raw ? `&at=${encodeURIComponent(raw)}` : '';
}

async function firstActiveWaiter(tenantId, candidateIds = []) {
  const ids = [...new Set(candidateIds.map(text).filter(Boolean))];
  for (const id of ids) {
    const waiter = await prisma.user.findFirst({
      where:{ id, tenantId, activo:true, rol:'MESERO' },
      select:{ id:true }
    });
    if (waiter) return waiter.id;
  }
  return null;
}

async function waiterAudience(tenantId, candidateIds = [], { includeAdmins = true } = {}) {
  const primaryWaiterId = await firstActiveWaiter(tenantId, candidateIds);
  const roles = includeAdmins ? [...ADMIN_ROLES] : [];
  if (!primaryWaiterId) roles.push('MESERO');
  return {
    primaryWaiterId,
    userIds:primaryWaiterId ? [primaryWaiterId] : [],
    roles
  };
}

async function qrContext(qrToken) {
  const table = await prisma.restaurantTable.findUnique({
    where:{ qrToken },
    select:{ id:true, tenantId:true, code:true, name:true, assignedWaiterId:true }
  });
  if (!table) return null;
  const session = await prisma.restaurantTableSession.findFirst({
    where:{ tenantId:table.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    orderBy:{ openedAt:'desc' },
    select:{ id:true, openedByUserId:true }
  });
  return { table, session };
}

async function notifyWaiterCall(tenantId, input = {}) {
  const audience = await waiterAudience(tenantId, [input.primaryWaiterId, input.openedByUserId, input.assignedWaiterId]);
  const label = tableLabel(input.table);
  const person = Number(input.seatNumber || 0) > 0 ? ` · Persona ${Number(input.seatNumber)}` : '';
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_WAITER_CALL_V25',
    title:`${label} llama al mesero`,
    body:`El cliente solicita atención${person}.`,
    deepLink:`/app/centro-de-control/mesero-v2?call=${encodeURIComponent(text(input.callId))}${eventSuffix(input.eventAt)}`,
    ...audience
  });
}

async function notifyWaiterCallFromQr(qrToken, callId = null) {
  const context = await qrContext(qrToken);
  if (!context?.session) return { matched:0, sent:0, failed:0, skipped:'NO_ACTIVE_SESSION' };
  const row = await prisma.trackingLink.findFirst({
    where:{
      tenantId:context.table.tenantId,
      originType:WAITER_CALL_ORIGIN,
      originId:context.session.id,
      ...(callId ? { id:callId } : { active:true })
    },
    orderBy:{ creadoEn:'desc' }
  });
  if (!row) return { matched:0, sent:0, failed:0, skipped:'WAITER_CALL_NOT_FOUND' };
  const meta = latestTimeline(row, 'CALL_CREATED') || {};
  return notifyWaiterCall(context.table.tenantId, {
    callId:row.id,
    eventAt:meta.at || row.creadoEn,
    primaryWaiterId:meta.primaryWaiterId || (row.publicReference !== 'ALL' ? row.publicReference : null),
    openedByUserId:context.session.openedByUserId,
    assignedWaiterId:context.table.assignedWaiterId,
    seatNumber:meta.seatNumber || null,
    table:context.table
  });
}

async function notifyAccountRequest(tenantId, input = {}) {
  const audience = await waiterAudience(tenantId, [input.primaryWaiterId, input.openedByUserId, input.assignedWaiterId]);
  const label = tableLabel(input.table);
  const person = Number(input.seatNumber || 0) > 0 ? `Persona ${Number(input.seatNumber)} solicita la cuenta.` : 'La mesa solicita la cuenta.';
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_ACCOUNT_REQUEST_V25',
    title:`${label} solicita la cuenta`,
    body:person,
    deepLink:`/app/centro-de-control/mesero-v2?accountRequest=${encodeURIComponent(text(input.requestId))}${eventSuffix(input.eventAt)}`,
    ...audience
  });
}

async function notifyAccountRequestFromQr(qrToken) {
  const context = await qrContext(qrToken);
  if (!context?.session) return { matched:0, sent:0, failed:0, skipped:'NO_ACTIVE_SESSION' };
  const row = await prisma.trackingLink.findFirst({
    where:{ tenantId:context.table.tenantId, originType:ACCOUNT_REQUEST_ORIGIN, originId:context.session.id, active:true },
    orderBy:{ creadoEn:'desc' }
  });
  if (!row) return { matched:0, sent:0, failed:0, skipped:'ACCOUNT_REQUEST_NOT_FOUND' };
  const meta = latestTimeline(row, 'ACCOUNT_REQUEST_CREATED') || {};
  return notifyAccountRequest(context.table.tenantId, {
    requestId:row.id,
    eventAt:meta.at || row.creadoEn,
    primaryWaiterId:meta.primaryWaiterId || (row.publicReference !== 'ALL' ? row.publicReference : null),
    openedByUserId:context.session.openedByUserId,
    assignedWaiterId:context.table.assignedWaiterId,
    seatNumber:meta.seatNumber || null,
    table:context.table
  });
}

async function notifyQrOrder(tenantId, input = {}) {
  const audience = await waiterAudience(tenantId, [input.openedByUserId, input.assignedWaiterId]);
  const label = tableLabel(input.table);
  const itemCount = Array.isArray(input.items) ? input.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0;
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_QR_ORDER_V25',
    title:`Nuevo pedido QR · ${label}`,
    body:itemCount > 0 ? `${itemCount} producto(s) enviados por el cliente.` : 'El cliente envió un nuevo pedido.',
    deepLink:`/app/centro-de-control/mesero-v2?qrOrder=${encodeURIComponent(text(input.orderId))}`,
    ...audience
  });
}

async function notifyQrOrderFromOrder(order = {}) {
  if (!order?.tenantId || !order?.id || !order?.sessionId) return { matched:0, sent:0, failed:0, skipped:'ORDER_CONTEXT_REQUIRED' };
  const session = await prisma.restaurantTableSession.findFirst({
    where:{ id:order.sessionId, tenantId:order.tenantId },
    select:{ openedByUserId:true, table:{ select:{ id:true, code:true, name:true, assignedWaiterId:true } } }
  });
  if (!session?.table) return { matched:0, sent:0, failed:0, skipped:'ORDER_TABLE_NOT_FOUND' };
  return notifyQrOrder(order.tenantId, {
    orderId:order.id,
    items:order.items || [],
    openedByUserId:session.openedByUserId,
    assignedWaiterId:session.table.assignedWaiterId,
    table:session.table
  });
}

async function notifyOrderReady(tenantId, input = {}) {
  const audience = await waiterAudience(tenantId, [input.createdByUserId, input.openedByUserId, input.assignedWaiterId]);
  const label = tableLabel(input.table);
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_ORDER_READY_V25',
    title:`Pedido listo · ${label}`,
    body:'Producción terminó el pedido. Está listo para entregar.',
    deepLink:`/app/centro-de-control/mesero-v2?readyOrder=${encodeURIComponent(text(input.orderId))}`,
    ...audience
  });
}

async function notifyOrderReadyFromOrder(order = {}) {
  if (!order?.tenantId || !order?.id) return { matched:0, sent:0, failed:0, skipped:'ORDER_CONTEXT_REQUIRED' };
  let session = order.session || null;
  if (!session?.table || !Object.prototype.hasOwnProperty.call(session, 'openedByUserId')) {
    session = await prisma.restaurantTableSession.findFirst({
      where:{ id:order.sessionId, tenantId:order.tenantId },
      select:{ openedByUserId:true, table:{ select:{ id:true, code:true, name:true, assignedWaiterId:true } } }
    });
  }
  if (!session?.table) return { matched:0, sent:0, failed:0, skipped:'ORDER_TABLE_NOT_FOUND' };
  return notifyOrderReady(order.tenantId, {
    orderId:order.id,
    createdByUserId:order.createdByUserId || null,
    openedByUserId:session.openedByUserId || null,
    assignedWaiterId:session.table.assignedWaiterId || null,
    table:session.table
  });
}

async function notifyTableOpenRequest(tenantId, input = {}) {
  const label = tableLabel(input.table);
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_TABLE_OPEN_REQUEST_V25',
    title:`${label} solicita atención`,
    body:'Un cliente escaneó el QR y solicita abrir la mesa.',
    deepLink:`/app/restaurante-v2/mesas?openRequest=${encodeURIComponent(text(input.requestId))}${eventSuffix(input.eventAt)}`,
    roles:['MESERO', ...ADMIN_ROLES]
  });
}

async function notifyTableOpenRequestFromQr(qrToken, request = {}) {
  const context = await qrContext(qrToken);
  if (!context?.table) return { matched:0, sent:0, failed:0, skipped:'TABLE_NOT_FOUND' };
  if (!request?.requested || request?.alreadyPending) return { matched:0, sent:0, failed:0, skipped:'NO_NEW_REQUEST' };
  return notifyTableOpenRequest(context.table.tenantId, {
    requestId:request.id || null,
    eventAt:request.createdAt || null,
    table:context.table
  });
}

module.exports = {
  ADMIN_ROLES,
  WAITER_CALL_ORIGIN,
  ACCOUNT_REQUEST_ORIGIN,
  firstActiveWaiter,
  waiterAudience,
  qrContext,
  notifyWaiterCall,
  notifyWaiterCallFromQr,
  notifyAccountRequest,
  notifyAccountRequestFromQr,
  notifyQrOrder,
  notifyQrOrderFromOrder,
  notifyOrderReady,
  notifyOrderReadyFromOrder,
  notifyTableOpenRequest,
  notifyTableOpenRequestFromQr
};
