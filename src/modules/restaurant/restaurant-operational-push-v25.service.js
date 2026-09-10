'use strict';

const { prisma } = require('../../config/prisma');
const push = require('../notifications/push-v65.service');

const ADMIN_ROLES = Object.freeze(['ADMIN','SUPER_ADMIN','ADMINISTRADOR']);

function text(value) {
  return String(value || '').trim();
}

function tableLabel(table) {
  return text(table?.code) || text(table?.name) || 'Mesa';
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

async function notifyWaiterCall(tenantId, input = {}) {
  const audience = await waiterAudience(tenantId, [input.primaryWaiterId, input.openedByUserId, input.assignedWaiterId]);
  const label = tableLabel(input.table);
  const person = Number(input.seatNumber || 0) > 0 ? ` · Persona ${Number(input.seatNumber)}` : '';
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_WAITER_CALL_V25',
    title:`${label} llama al mesero`,
    body:`El cliente solicita atención${person}.`,
    deepLink:`/app/centro-de-control/mesero-v2?call=${encodeURIComponent(text(input.callId))}`,
    ...audience
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
    deepLink:`/app/centro-de-control/mesero-v2?accountRequest=${encodeURIComponent(text(input.requestId))}`,
    ...audience
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

async function notifyTableOpenRequest(tenantId, input = {}) {
  const label = tableLabel(input.table);
  return push.sendOperationalEvent(tenantId, {
    eventCode:'RESTAURANT_TABLE_OPEN_REQUEST_V25',
    title:`${label} solicita atención`,
    body:'Un cliente escaneó el QR y solicita abrir la mesa.',
    deepLink:`/app/restaurante-v2/mesas?openRequest=${encodeURIComponent(text(input.requestId))}`,
    roles:['MESERO', ...ADMIN_ROLES]
  });
}

module.exports = {
  ADMIN_ROLES,
  firstActiveWaiter,
  waiterAudience,
  notifyWaiterCall,
  notifyAccountRequest,
  notifyQrOrder,
  notifyOrderReady,
  notifyTableOpenRequest
};
