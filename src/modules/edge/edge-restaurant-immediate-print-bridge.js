'use strict';

const { prisma } = require('../../config/prisma');
const restaurant = require('../restaurant/restaurant.service');

const INSTALL_FLAG = Symbol.for('vantixgc.restaurant.immediate.print.bridge.v1');
const RELAY_ACTION = 'PRINT_QUEUE';
const ONLINE_WINDOW_MS = 90000;

function commandIdsFromOrder(order) {
  return (Array.isArray(order?.commands) ? order.commands : [])
    .map((command) => String(command?.id || '').trim())
    .filter(Boolean);
}

async function requestImmediatePrint(tenantId, order, client = prisma) {
  const commandIds = commandIdsFromOrder(order);
  if (!tenantId || !commandIds.length) return { queued: false, reason: 'NO_COMMANDS' };

  const now = new Date();
  const installation = await client.edgeInstallation.findFirst({
    where: {
      tenantId,
      relayConnected: true,
      lastHeartbeatAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) }
    },
    orderBy: { lastHeartbeatAt: 'desc' },
    select: { edgeAgentId: true, lastHeartbeatAt: true }
  });
  if (!installation?.edgeAgentId) return { queued: false, reason: 'NO_ONLINE_EDGE' };

  const agent = await client.edgeAgent.findFirst({
    where: { id: installation.edgeAgentId, tenantId, state: 'ACTIVE' },
    select: { id: true }
  });
  if (!agent) return { queued: false, reason: 'NO_ACTIVE_EDGE' };

  const request = await client.edgeRelayRequest.create({
    data: {
      tenantId,
      edgeAgentId: agent.id,
      action: RELAY_ACTION,
      requestBody: {
        reason: 'RESTAURANT_WAITER_SEND_TO_KITCHEN',
        orderId: order.id || null,
        commandIds
      },
      expiresAt: new Date(now.getTime() + 30000)
    },
    select: { id: true, edgeAgentId: true, action: true, creadoEn: true }
  });

  return { queued: true, relayRequestId: request.id, edgeAgentId: request.edgeAgentId, commandIds };
}

function install() {
  if (restaurant[INSTALL_FLAG]) return restaurant;
  const original = restaurant.placeWaiterOrder.bind(restaurant);
  restaurant.placeWaiterOrder = async function placeWaiterOrderWithImmediatePrint(tenantId, user, sessionId, input) {
    const order = await original(tenantId, user, sessionId, input);
    try { await requestImmediatePrint(tenantId, order); } catch {}
    return order;
  };
  Object.defineProperty(restaurant, INSTALL_FLAG, { value: true });
  return restaurant;
}

install();

module.exports = {
  INSTALL_FLAG,
  RELAY_ACTION,
  ONLINE_WINDOW_MS,
  commandIdsFromOrder,
  requestImmediatePrint,
  install
};
