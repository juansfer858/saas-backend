'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const restaurant = require('./restaurant.service');
const delivery = require('./restaurant-delivery.service');
const work = require('./restaurant-employee-work.service');
const stations = require('../platform/printing/printing-stations.service');
const operationalPush = require('./restaurant-operational-push-v25.service');

const MARKER = 'VANTIX_RESTAURANT_V2_KDS_P6';
const DELIVERY_INTEGRATION = 'VANTIX_RESTAURANT_V2_KDS_DELIVERY_V87';
const QUEUES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const ACTIVE_STATES = Object.freeze(['PENDIENTE', 'EN_PREPARACION', 'LISTA']);
const NEXT_STATE = Object.freeze({ PENDIENTE:'EN_PREPARACION', EN_PREPARACION:'LISTA', LISTA:'ENTREGADA' });

function normalizeQueue(value) {
  const queue = String(value || '').trim().toUpperCase();
  if (!queue) return null;
  if (!QUEUES.includes(queue)) throw new AppError(400, 'Estación KDS inválida', 'RESTAURANT_V2_KDS_QUEUE_INVALID');
  return queue;
}

function queueLabel(queue) {
  return queue === 'COCINA' ? 'Cocina' : queue === 'BARRA' ? 'Barra' : queue === 'POSTRES' ? 'Postres' : queue;
}

function runtimeUser(user) {
  return work.productionRuntimeUser(user);
}

function normalizeLimit(value) {
  return Math.min(Math.max(Number(value) || 300, 1), 500);
}

function commandTime(row) {
  const value = new Date(row?.creadoEn || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function validateTransition(command, targetState) {
  const expected = NEXT_STATE[command.state];
  if (!expected) throw new AppError(409, 'La comanda ya no admite acciones operativas', 'RESTAURANT_V2_KDS_COMMAND_FINAL', { state:command.state });
  if (targetState !== expected) {
    throw new AppError(409, `La transición válida es ${command.state} → ${expected}`, 'RESTAURANT_V2_KDS_TRANSITION_INVALID', { current:command.state, expected, requested:targetState });
  }
  return expected;
}

async function stationMatrix(tenantId, profile) {
  const rows = await stations.listStations(tenantId, { includeInactive:false });
  const byQueue = new Map(QUEUES.map((queue) => [queue, []]));
  for (const row of rows) {
    if (!row.active || !['KDS','AMBOS'].includes(row.mode) || !byQueue.has(row.queue)) continue;
    byQueue.get(row.queue).push({ id:row.id, name:row.name, mode:row.mode, sortOrder:row.sortOrder });
  }
  const preferred = new Set(profile?.stations || []);
  return QUEUES.map((queue) => ({
    queue,
    label:queueLabel(queue),
    preferred:preferred.has(queue),
    configured:byQueue.get(queue).length > 0,
    stations:byQueue.get(queue)
  })).sort((a,b) => Number(b.preferred)-Number(a.preferred) || QUEUES.indexOf(a.queue)-QUEUES.indexOf(b.queue));
}

async function workspace(tenantId, user, input = {}) {
  const profile = await work.getProfile(tenantId, user.id);
  const matrix = await stationMatrix(tenantId, profile);
  const requested = normalizeQueue(input.station);
  const fallback = profile.stations?.[0] || (QUEUES.includes(String(user.rol || '').toUpperCase()) ? String(user.rol).toUpperCase() : null);
  const selectedStation = requested || fallback || matrix.find((row) => row.configured)?.queue || 'COCINA';
  const limit = normalizeLimit(input.limit);
  const productionUser = runtimeUser(user);
  const [restaurantCommands, deliveryCommands] = await Promise.all([
    restaurant.listCommands(tenantId, productionUser, { station:selectedStation, limit }),
    delivery.listKdsCommands(tenantId, productionUser, { station:selectedStation, limit })
  ]);
  const active = [
    ...restaurantCommands.map((row) => ({ ...row, commandSource:'RESTAURANT' })),
    ...deliveryCommands.map((row) => ({ ...row, commandSource:'DOMICILIO' }))
  ]
    .filter((row) => ACTIVE_STATES.includes(String(row.state || '')))
    .sort((a,b) => commandTime(a)-commandTime(b))
    .slice(0, limit);
  const stats = Object.fromEntries(ACTIVE_STATES.map((state) => [state, active.filter((row) => row.state === state).length]));
  return {
    marker:MARKER,
    deliveryIntegration:DELIVERY_INTEGRATION,
    transport:'TENANT_REALTIME_V1',
    push:'FCM_V65_BEST_EFFORT',
    profile,
    selectedStation,
    queues:matrix,
    commands:active,
    stats:{ ...stats, active:active.length },
    transitions:NEXT_STATE
  };
}

async function updateState(tenantId, user, commandId, targetState) {
  const command = await prisma.restaurantCommand.findFirst({
    where:{ id:commandId, tenantId },
    select:{ id:true, station:true, state:true, orderId:true }
  });
  if (command) {
    validateTransition(command, targetState);
    const updated = await restaurant.updateCommandState(tenantId, runtimeUser(user), command.id, targetState);
    // El estado de la comanda/pedido ya quedó persistido. Push sólo avisa al piso y jamás
    // participa en la transición KDS ni puede revertirla si FCM está caído.
    if (updated?.becameReady && updated?.order) {
      void operationalPush.notifyOrderReadyFromOrder(updated.order).catch(()=>{});
    }
    return { marker:MARKER, deliveryIntegration:DELIVERY_INTEGRATION, commandSource:'RESTAURANT', command:updated, previousState:command.state, state:targetState };
  }

  const deliveryCommand = await prisma.restaurantDeliveryCommand.findFirst({
    where:{ id:commandId, tenantId },
    select:{ id:true, station:true, state:true, deliveryId:true }
  });
  if (!deliveryCommand) throw new AppError(404, 'Comanda no encontrada', 'RESTAURANT_COMMAND_NOT_FOUND');
  validateTransition(deliveryCommand, targetState);
  const updatedDelivery = await delivery.updateDeliveryCommandState(tenantId, runtimeUser(user), deliveryCommand.id, targetState);
  const updatedCommand = await prisma.restaurantDeliveryCommand.findFirst({
    where:{ id:deliveryCommand.id, tenantId },
    select:{ id:true, station:true, state:true, deliveryId:true, startedAt:true, readyAt:true, deliveredAt:true, actualizadoEn:true }
  });
  return {
    marker:MARKER,
    deliveryIntegration:DELIVERY_INTEGRATION,
    commandSource:'DOMICILIO',
    command:updatedCommand,
    delivery:updatedDelivery,
    previousState:deliveryCommand.state,
    state:targetState
  };
}

module.exports = {
  MARKER,
  DELIVERY_INTEGRATION,
  QUEUES,
  ACTIVE_STATES,
  NEXT_STATE,
  normalizeQueue,
  stationMatrix,
  workspace,
  updateState
};
