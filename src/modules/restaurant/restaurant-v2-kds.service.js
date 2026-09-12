'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const restaurant = require('./restaurant.service');
const delivery = require('./restaurant-delivery.service');
const work = require('./restaurant-employee-work.service');
const stations = require('../platform/printing/printing-stations.service');
const operationalPush = require('./restaurant-operational-push-v25.service');
const realtime = require('../realtime/tenant-realtime.service');

const MARKER = 'VANTIX_RESTAURANT_V2_KDS_P6';
const DELIVERY_INTEGRATION = 'VANTIX_RESTAURANT_V2_KDS_DELIVERY_V87';
const ORDER_CANCEL_MARKER = 'VANTIX_RESTAURANT_V2_KDS_ORDER_CANCEL_V97';
const QUEUES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const ACTIVE_STATES = Object.freeze(['PENDIENTE', 'EN_PREPARACION', 'LISTA']);
const CANCELABLE_COMMAND_STATES = Object.freeze(['PENDIENTE', 'EN_PREPARACION', 'LISTA']);
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

function uniqueStations(commands = []) {
  const seen = new Set();
  const result = [];
  for (const command of commands) {
    const station = String(command?.station || '').trim();
    if (!station || seen.has(station)) continue;
    seen.add(station);
    result.push(station);
  }
  return result;
}

function cancellationEligibility(order, sale) {
  if (!order || order.state !== 'EN_PREPARACION') return { canCancelOrder:false, cancellationBlockReason:'ORDER_NOT_PREPARING' };
  const commands = Array.isArray(order.commands) ? order.commands : [];
  if (!commands.length || commands.some((row) => !CANCELABLE_COMMAND_STATES.includes(row.state))) {
    return { canCancelOrder:false, cancellationBlockReason:'COMMAND_ALREADY_FINAL' };
  }
  if (!sale || sale.estado !== 'BORRADOR') return { canCancelOrder:false, cancellationBlockReason:'SALE_NOT_DRAFT' };
  if ((order.session?.sessionPayments || []).length > 0) return { canCancelOrder:false, cancellationBlockReason:'PAYMENT_EXISTS' };
  return { canCancelOrder:true, cancellationBlockReason:null };
}

async function cancellationMap(tenantId, rows) {
  const orderIds = [...new Set((rows || []).map((row) => row?.orderId || row?.order?.id).filter(Boolean))];
  if (!orderIds.length) return new Map();
  const orders = await prisma.restaurantOrder.findMany({
    where:{ tenantId, id:{ in:orderIds } },
    include:{
      commands:{ select:{ id:true, station:true, state:true } },
      session:{
        include:{
          table:{ select:{ id:true, code:true, name:true } },
          sessionPayments:{ select:{ id:true } }
        }
      }
    }
  });
  const saleIds = [...new Set(orders.map((order) => order.session?.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where:{ tenantId, id:{ in:saleIds } },
    select:{ id:true, estado:true }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  return new Map(orders.map((order) => {
    const eligibility = cancellationEligibility(order, saleById.get(order.session?.saleId));
    return [order.id, {
      ...eligibility,
      cancellationStations:uniqueStations(order.commands)
    }];
  }));
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
  const cancelMap = await cancellationMap(tenantId, restaurantCommands);
  const active = [
    ...restaurantCommands.map((row) => ({
      ...row,
      commandSource:'RESTAURANT',
      ...(cancelMap.get(row.orderId || row.order?.id) || { canCancelOrder:false, cancellationBlockReason:'ORDER_NOT_FOUND', cancellationStations:[] })
    })),
    ...deliveryCommands.map((row) => ({ ...row, commandSource:'DOMICILIO', canCancelOrder:false, cancellationStations:[] }))
  ]
    .filter((row) => ACTIVE_STATES.includes(String(row.state || '')))
    .sort((a,b) => commandTime(a)-commandTime(b))
    .slice(0, limit);
  const stats = Object.fromEntries(ACTIVE_STATES.map((state) => [state, active.filter((row) => row.state === state).length]));
  return {
    marker:MARKER,
    deliveryIntegration:DELIVERY_INTEGRATION,
    orderCancellation:ORDER_CANCEL_MARKER,
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

function cancellationReason(value) {
  const reason = String(value || '').trim();
  if (!reason) throw new AppError(400, 'Debe indicar el motivo de la cancelación', 'RESTAURANT_V2_KDS_CANCEL_REASON_REQUIRED');
  if (reason.length > 500) throw new AppError(400, 'El motivo de cancelación supera 500 caracteres', 'RESTAURANT_V2_KDS_CANCEL_REASON_TOO_LONG');
  return reason;
}

function sumDetails(details, field) {
  return (details || []).reduce((acc, row) => money(acc.plus(row?.[field] || 0)), money(0));
}

async function cancelOrder(tenantId, user, orderId, input = {}) {
  const reason = cancellationReason(input.reason);
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.restaurantOrder.findFirst({
      where:{ id:orderId, tenantId },
      include:{
        items:true,
        commands:true,
        session:{
          include:{
            table:true,
            sessionPayments:true
          }
        }
      }
    });
    if (!order) throw new AppError(404, 'Pedido no encontrado', 'RESTAURANT_ORDER_NOT_FOUND');
    if (order.state !== 'EN_PREPARACION') {
      throw new AppError(409, 'Solo se puede cancelar un pedido completo mientras está en preparación', 'RESTAURANT_V2_KDS_CANCEL_ORDER_STATE_INVALID', { state:order.state });
    }
    if (!order.commands.length || order.commands.some((row) => !CANCELABLE_COMMAND_STATES.includes(row.state))) {
      throw new AppError(409, 'El pedido ya tiene una estación entregada o finalizada y no puede cancelarse desde Producción', 'RESTAURANT_V2_KDS_CANCEL_COMMAND_FINAL', {
        commands:order.commands.map((row) => ({ id:row.id, station:row.station, state:row.state }))
      });
    }
    if (order.session.sessionPayments.length > 0) {
      throw new AppError(409, 'El pedido ya tiene pagos registrados y no puede cancelarse desde Producción', 'RESTAURANT_V2_KDS_CANCEL_PAYMENT_EXISTS');
    }

    const sale = await tx.comprobanteComercial.findFirst({
      where:{ id:order.session.saleId, tenantId },
      select:{ id:true, numero:true, estado:true }
    });
    if (!sale || sale.estado !== 'BORRADOR') {
      throw new AppError(409, 'La venta asociada ya fue emitida o liquidada; la cancelación operativa está bloqueada', 'RESTAURANT_V2_KDS_CANCEL_SALE_NOT_DRAFT', { saleState:sale?.estado || null });
    }

    const saleDetailIds = [...new Set(order.items.map((item) => item.saleDetailId).filter(Boolean))];
    if (!saleDetailIds.length || saleDetailIds.length !== order.items.length) {
      throw new AppError(409, 'No se pudo validar la relación completa entre pedido y venta', 'RESTAURANT_V2_KDS_CANCEL_SALE_LINK_INCOMPLETE');
    }
    const details = await tx.detalleComprobante.findMany({
      where:{ tenantId, comprobanteId:sale.id, id:{ in:saleDetailIds } },
      select:{ id:true, subtotalLinea:true, ivaValor:true, impoconsumoValor:true, totalLinea:true }
    });
    if (details.length !== saleDetailIds.length) {
      throw new AppError(409, 'La venta ya cambió y no coincide con el pedido a cancelar', 'RESTAURANT_V2_KDS_CANCEL_SALE_DETAILS_CHANGED');
    }

    const totals = {
      subtotal:sumDetails(details, 'subtotalLinea'),
      iva:sumDetails(details, 'ivaValor'),
      impoconsumo:sumDetails(details, 'impoconsumoValor'),
      total:sumDetails(details, 'totalLinea')
    };
    const affectedStations = uniqueStations(order.commands);
    const previousCommands = order.commands.map((row) => ({ id:row.id, station:row.station, state:row.state }));

    // Reclamar el pedido evita dobles cancelaciones concurrentes. Si otro proceso cambió
    // el agregado mientras se confirmaba el motivo, toda la operación se aborta sin efectos parciales.
    const claimedOrder = await tx.restaurantOrder.updateMany({
      where:{ id:order.id, tenantId, state:'EN_PREPARACION' },
      data:{ state:'CANCELADO' }
    });
    if (claimedOrder.count !== 1) {
      throw new AppError(409, 'El pedido cambió mientras se confirmaba la cancelación', 'RESTAURANT_V2_KDS_CANCEL_ORDER_RACE');
    }

    // Ninguna estación puede quedar activa. El filtro de estado detecta una entrega
    // concurrente y fuerza rollback de la cancelación completa.
    const cancelledCommands = await tx.restaurantCommand.updateMany({
      where:{ tenantId, orderId:order.id, state:{ in:CANCELABLE_COMMAND_STATES } },
      data:{ state:'CANCELADA' }
    });
    if (cancelledCommands.count !== order.commands.length) {
      throw new AppError(409, 'Una estación cambió de estado durante la cancelación; no se modificó el pedido', 'RESTAURANT_V2_KDS_CANCEL_COMMAND_RACE');
    }

    // La venta debe seguir siendo BORRADOR al momento exacto de afectar sus totales.
    const updatedSale = await tx.comprobanteComercial.updateMany({
      where:{ id:sale.id, tenantId, estado:'BORRADOR' },
      data:{
        subtotal:{ decrement:totals.subtotal },
        ivaTotal:{ decrement:totals.iva },
        impoconsumoTotal:{ decrement:totals.impoconsumo },
        total:{ decrement:totals.total }
      }
    });
    if (updatedSale.count !== 1) {
      throw new AppError(409, 'La venta dejó de estar en borrador durante la cancelación', 'RESTAURANT_V2_KDS_CANCEL_SALE_RACE');
    }

    const deletedDetails = await tx.detalleComprobante.deleteMany({
      where:{ tenantId, comprobanteId:sale.id, id:{ in:saleDetailIds } }
    });
    if (deletedDetails.count !== saleDetailIds.length) {
      throw new AppError(409, 'Las líneas de la venta cambiaron durante la cancelación', 'RESTAURANT_V2_KDS_CANCEL_SALE_DETAILS_RACE');
    }

    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_ORDER',
        entidadId:order.id,
        accion:'RESTAURANT_ORDER_CANCELLED_KDS',
        metadata:{
          label:'Cancelación de pedido en Producción/KDS',
          module:'RESTAURANT_KDS',
          subject:'ORDER_CANCELLATION',
          reason,
          pedido:{ id:order.id, stateBefore:order.state, stateAfter:'CANCELADO', total:String(order.total) },
          mesa:order.session?.table ? { id:order.session.table.id, code:order.session.table.code, name:order.session.table.name } : null,
          stations:affectedStations,
          commandsBefore:previousCommands,
          commandsAfter:previousCommands.map((row) => ({ ...row, state:'CANCELADA' })),
          sale:{ id:sale.id, numero:sale.numero, estado:'BORRADOR', removedDetailIds:saleDetailIds },
          removedTotals:{ subtotal:String(totals.subtotal), iva:String(totals.iva), impoconsumo:String(totals.impoconsumo), total:String(totals.total) },
          inventory:{ consumed:false, reversalRequired:false, reason:'SALE_REMAINS_DRAFT_AND_INVENTORY_IS_CONSUMED_ON_SALE_EMISSION' }
        }
      }
    });

    return {
      orderId:order.id,
      orderState:'CANCELADO',
      saleId:sale.id,
      tableId:order.session?.tableId || order.session?.table?.id || null,
      stations:affectedStations,
      reason,
      commands:previousCommands.map((row) => ({ ...row, state:'CANCELADA' })),
      removedSaleDetails:saleDetailIds.length,
      inventoryReversalRequired:false
    };
  });

  realtime.publishTenantChange(
    tenantId,
    ['restaurant','restaurant.order','restaurant.command'],
    { orderId:result.orderId, tableId:result.tableId },
    { source:'restaurant-v2-kds-order-cancel-v97', action:'cancel-order' }
  ).catch(()=>{});

  return { marker:MARKER, orderCancellation:ORDER_CANCEL_MARKER, commandSource:'RESTAURANT', ...result };
}

module.exports = {
  MARKER,
  DELIVERY_INTEGRATION,
  ORDER_CANCEL_MARKER,
  QUEUES,
  ACTIVE_STATES,
  CANCELABLE_COMMAND_STATES,
  NEXT_STATE,
  normalizeQueue,
  stationMatrix,
  cancellationEligibility,
  cancellationMap,
  cancellationReason,
  workspace,
  updateState,
  cancelOrder
};
