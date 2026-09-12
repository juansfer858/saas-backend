'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const kds = require('../src/modules/restaurant/restaurant-v2-kds.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

function sum(rows, field) {
  return rows.reduce((acc, row) => money(acc.plus(row[field] || 0)), money(0));
}

async function latestOrder(tenantId, sessionId) {
  return prisma.restaurantOrder.findFirst({
    where:{ tenantId, sessionId },
    orderBy:{ creadoEn:'desc' },
    include:{ items:true, commands:true, session:{ include:{ table:true } } }
  });
}

async function addRound(tenantId, waiter, sessionId, kitchenId, barId) {
  await identity.setWaiterDraftItem(tenantId, waiter, sessionId, kitchenId, 1, 1, V2_OPTIONS);
  await identity.setWaiterDraftItem(tenantId, waiter, sessionId, barId, 1, 1, V2_OPTIONS);
  await identity.sendWaiterDraft(tenantId, waiter, sessionId, V2_OPTIONS);
  const order = await latestOrder(tenantId, sessionId);
  assert.ok(order, 'la ronda debe crear un pedido real');
  assert.equal(order.commands.length, 2, 'la ronda Cocina + Barra debe crear dos comandas');
  assert.deepEqual(new Set(order.commands.map((row) => row.station)), new Set(['COCINA','BARRA']));
  return order;
}

async function main() {
  const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.routes.js', 'utf8');
  const service = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.service.js', 'utf8');
  const html = fs.readFileSync('src/web/restaurant-v2-kds.html', 'utf8');
  const ui = fs.readFileSync('src/web/restaurant-v2-kds.js', 'utf8');

  assert.match(routes, /\/v2\/kds\/pedidos\/:id\/cancelar/);
  assert.match(routes, /reason:z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(service, /VANTIX_RESTAURANT_V2_KDS_ORDER_CANCEL_V97/);
  assert.match(service, /RESTAURANT_ORDER_CANCELLED_KDS/);
  assert.match(service, /state:'CANCELADA'/);
  assert.match(service, /state:'CANCELADO'/);
  assert.match(service, /estado:'BORRADOR'/);
  assert.match(service, /saleDetailId/);
  assert.match(html, /cancelReason/);
  assert.match(ui, /Cancelar pedido/);
  assert.match(ui, /VANTIX_RESTAURANT_V2_KDS_ORDER_CANCEL_V97/);

  assert.equal(
    kds.cancellationEligibility(
      { state:'EN_PREPARACION', commands:[{state:'EN_PREPARACION'}], session:{sessionPayments:[]} },
      { estado:'EMITIDO' }
    ).canCancelOrder,
    false,
    'una venta fuera de BORRADOR nunca puede exponerse como cancelable'
  );

  await assert.rejects(
    () => kds.cancelOrder('tenant-fake', { id:'user-fake' }, 'order-fake', { reason:'   ' }),
    (error) => error?.code === 'RESTAURANT_V2_KDS_CANCEL_REASON_REQUIRED',
    'el motivo debe ser obligatorio también en backend'
  );

  const demo = await ensureRestaurantDemoTenant();
  const [waiter, cook, kitchenMenuItem, barMenuItem] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } }),
    prisma.user.findUnique({ where:{ id:demo.users.COCINA } }),
    prisma.restaurantMenuItem.findFirst({ where:{ tenantId:demo.tenantId, active:true, station:'COCINA' }, orderBy:{ sortOrder:'asc' } }),
    prisma.restaurantMenuItem.findFirst({ where:{ tenantId:demo.tenantId, active:true, station:'BARRA' }, orderBy:{ sortOrder:'asc' } })
  ]);
  assert.ok(waiter && cook && kitchenMenuItem && barMenuItem, 'el demo necesita Mesero, Cocina y productos de Cocina/Barra');

  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`Cancel V97 ${suffix}`, sortOrder:997 } });
  const table = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`C97-${suffix}`, name:`Mesa Cancel V97 ${suffix}`, seats:4, assignedWaiterId:waiter.id }
  });
  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2 }, V2_OPTIONS);

  const order = await addRound(demo.tenantId, waiter, opened.session.id, kitchenMenuItem.id, barMenuItem.id);
  for (const command of order.commands) {
    await kds.updateState(demo.tenantId, cook, command.id, 'EN_PREPARACION');
  }

  const preparing = await latestOrder(demo.tenantId, opened.session.id);
  assert.equal(preparing.state, 'EN_PREPARACION', 'el pedido debe estar EN_PREPARACION antes de cancelar');
  assert.equal(preparing.commands.every((row) => row.state === 'EN_PREPARACION'), true);

  const workspace = await kds.workspace(demo.tenantId, cook, { station:'COCINA' });
  const visible = workspace.commands.find((row) => row.orderId === preparing.id || row.order?.id === preparing.id);
  assert.ok(visible, 'KDS debe mostrar la comanda del pedido');
  assert.equal(visible.canCancelOrder, true, 'KDS debe habilitar Cancelar pedido mientras es seguro');
  assert.deepEqual(new Set(visible.cancellationStations), new Set(['COCINA','BARRA']), 'el botón debe representar todas las estaciones del pedido');

  const saleBefore = await prisma.comprobanteComercial.findFirst({ where:{ id:preparing.session.saleId, tenantId:demo.tenantId } });
  assert.equal(saleBefore.estado, 'BORRADOR');
  const detailIds = preparing.items.map((row) => row.saleDetailId);
  assert.equal(detailIds.every(Boolean), true, 'cada item del pedido debe estar enlazado a una línea de venta');
  const saleDetails = await prisma.detalleComprobante.findMany({
    where:{ tenantId:demo.tenantId, comprobanteId:saleBefore.id, id:{ in:detailIds } },
    select:{ id:true, subtotalLinea:true, ivaValor:true, impoconsumoValor:true, totalLinea:true }
  });
  assert.equal(saleDetails.length, detailIds.length);
  const removed = {
    subtotal:sum(saleDetails,'subtotalLinea'),
    iva:sum(saleDetails,'ivaValor'),
    impoconsumo:sum(saleDetails,'impoconsumoValor'),
    total:sum(saleDetails,'totalLinea')
  };

  const reason = `Cliente canceló pedido completo CI ${suffix}`;
  const cancelled = await kds.cancelOrder(demo.tenantId, cook, preparing.id, { reason });
  assert.equal(cancelled.orderState, 'CANCELADO');
  assert.equal(cancelled.inventoryReversalRequired, false, 'no debe inventar reversión: inventario aún no fue consumido');
  assert.deepEqual(new Set(cancelled.stations), new Set(['COCINA','BARRA']));

  const [orderAfter, saleAfter, remainingDetails, audit] = await Promise.all([
    prisma.restaurantOrder.findUnique({ where:{ id:preparing.id }, include:{ commands:true } }),
    prisma.comprobanteComercial.findUnique({ where:{ id:saleBefore.id } }),
    prisma.detalleComprobante.findMany({ where:{ id:{ in:detailIds } } }),
    prisma.auditoriaContable.findFirst({
      where:{ tenantId:demo.tenantId, entidad:'RESTAURANT_ORDER', entidadId:preparing.id, accion:'RESTAURANT_ORDER_CANCELLED_KDS' },
      orderBy:{ creadoEn:'desc' }
    })
  ]);
  assert.equal(orderAfter.state, 'CANCELADO');
  assert.equal(orderAfter.commands.length, 2);
  assert.equal(orderAfter.commands.every((row) => row.state === 'CANCELADA'), true, 'Cocina y Barra deben cancelarse juntas');
  assert.equal(remainingDetails.length, 0, 'las líneas canceladas no pueden quedar cobrables');
  assert.equal(saleAfter.estado, 'BORRADOR');
  assert.equal(money(saleAfter.subtotal).toString(), money(money(saleBefore.subtotal).minus(removed.subtotal)).toString());
  assert.equal(money(saleAfter.ivaTotal).toString(), money(money(saleBefore.ivaTotal).minus(removed.iva)).toString());
  assert.equal(money(saleAfter.impoconsumoTotal).toString(), money(money(saleBefore.impoconsumoTotal).minus(removed.impoconsumo)).toString());
  assert.equal(money(saleAfter.total).toString(), money(money(saleBefore.total).minus(removed.total)).toString());
  assert.ok(audit, 'la cancelación debe dejar Auditoría durable');
  assert.equal(audit.userId, cook.id);
  assert.equal(audit.metadata.reason, reason);
  assert.equal(audit.metadata.pedido.id, preparing.id);
  assert.equal(audit.metadata.mesa.id, table.id);
  assert.deepEqual(new Set(audit.metadata.stations), new Set(['COCINA','BARRA']));
  assert.equal(audit.metadata.inventory.reversalRequired, false);

  await assert.rejects(
    () => kds.cancelOrder(demo.tenantId, cook, preparing.id, { reason:'Segundo intento' }),
    (error) => error?.code === 'RESTAURANT_V2_KDS_CANCEL_ORDER_STATE_INVALID',
    'una segunda cancelación no puede afectar totales dos veces'
  );

  // Nueva ronda para comprobar que una sola estación entregada bloquea la cancelación completa.
  const protectedOrder = await addRound(demo.tenantId, waiter, opened.session.id, kitchenMenuItem.id, barMenuItem.id);
  for (const command of protectedOrder.commands) {
    await kds.updateState(demo.tenantId, cook, command.id, 'EN_PREPARACION');
  }
  const kitchenCommand = protectedOrder.commands.find((row) => row.station === 'COCINA');
  await kds.updateState(demo.tenantId, cook, kitchenCommand.id, 'LISTA');
  await kds.updateState(demo.tenantId, cook, kitchenCommand.id, 'ENTREGADA');

  await assert.rejects(
    () => kds.cancelOrder(demo.tenantId, cook, protectedOrder.id, { reason:'No debe permitir parcial' }),
    (error) => ['RESTAURANT_V2_KDS_CANCEL_ORDER_STATE_INVALID','RESTAURANT_V2_KDS_CANCEL_COMMAND_FINAL'].includes(error?.code),
    'si una estación ya fue entregada no puede cancelarse silenciosamente el resto'
  );
  const protectedAfter = await prisma.restaurantOrder.findUnique({ where:{ id:protectedOrder.id }, include:{ commands:true } });
  assert.equal(protectedAfter.commands.some((row) => row.station === 'COCINA' && row.state === 'ENTREGADA'), true);
  assert.equal(protectedAfter.commands.some((row) => row.station === 'BARRA' && row.state === 'EN_PREPARACION'), true, 'el rechazo no puede modificar estaciones restantes');

  console.log('Restaurant V2 KDS Order Cancel V97 DB smoke OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
