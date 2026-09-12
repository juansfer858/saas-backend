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
  assert.equal(order.state, 'ENVIADO', 'un pedido aún no tomado debe permanecer ENVIADO');
  assert.equal(order.commands.length, 2, 'la ronda Cocina + Barra debe crear dos comandas');
  assert.equal(order.commands.every((row) => row.state === 'PENDIENTE'), true, 'todas las comandas nuevas deben estar PENDIENTE');
  assert.deepEqual(new Set(order.commands.map((row) => row.station)), new Set(['COCINA','BARRA']));
  return order;
}

async function main() {
  const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.routes.js', 'utf8');
  const service = fs.readFileSync('src/modules/restaurant/restaurant-v2-kds.service.js', 'utf8');
  const html = fs.readFileSync('src/web/restaurant-v2-kds.html', 'utf8');
  const ui = fs.readFileSync('src/web/restaurant-v2-kds.js', 'utf8');
  const css = fs.readFileSync('src/web/restaurant-v2-kds.css', 'utf8');

  assert.match(routes, /\/v2\/kds\/pedidos\/:id\/cancelar/);
  assert.match(routes, /reason:z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(service, /VANTIX_RESTAURANT_V2_KDS_ORDER_CANCEL_V98/);
  assert.match(service, /CANCELABLE_COMMAND_STATES = Object\.freeze\(\['PENDIENTE'\]\)/);
  assert.match(service, /order\.state !== 'ENVIADO'/);
  assert.match(service, /row\.state !== 'PENDIENTE'/);
  assert.match(service, /RESTAURANT_ORDER_CANCELLED_KDS/);
  assert.match(service, /estado:'BORRADOR'/);
  assert.match(html, /cancelReason/);
  assert.match(ui, /VANTIX_RESTAURANT_V2_KDS_ORDER_CANCEL_V98/);
  assert.match(ui, /c\.state==='PENDIENTE'.*c\.canCancelOrder/);
  assert.match(ui, /Tomar comanda/);
  assert.match(css, /\.cancel-reason\[hidden\]\{display:none!important\}/);

  assert.equal(
    kds.cancellationEligibility(
      { state:'ENVIADO', commands:[{state:'PENDIENTE'}], session:{sessionPayments:[]} },
      { estado:'BORRADOR' }
    ).canCancelOrder,
    true,
    'pedido enviado y todavía no tomado debe ser cancelable'
  );
  assert.equal(
    kds.cancellationEligibility(
      { state:'EN_PREPARACION', commands:[{state:'EN_PREPARACION'}], session:{sessionPayments:[]} },
      { estado:'BORRADOR' }
    ).canCancelOrder,
    false,
    'en preparación ya no puede cancelarse'
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
  const zone = await prisma.restaurantZone.create({ data:{ tenantId:demo.tenantId, name:`Cancel V98 ${suffix}`, sortOrder:998 } });
  const table = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:`C98-${suffix}`, name:`Mesa Cancel V98 ${suffix}`, seats:4, assignedWaiterId:waiter.id }
  });
  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2 }, V2_OPTIONS);

  const pendingOrder = await addRound(demo.tenantId, waiter, opened.session.id, kitchenMenuItem.id, barMenuItem.id);
  const workspace = await kds.workspace(demo.tenantId, cook, { station:'COCINA' });
  const visible = workspace.commands.find((row) => row.orderId === pendingOrder.id || row.order?.id === pendingOrder.id);
  assert.ok(visible, 'KDS debe mostrar la comanda pendiente');
  assert.equal(visible.state, 'PENDIENTE');
  assert.equal(visible.canCancelOrder, true, 'Cancelar pedido debe aparecer antes de Tomar comanda');
  assert.deepEqual(new Set(visible.cancellationStations), new Set(['COCINA','BARRA']));

  const saleBefore = await prisma.comprobanteComercial.findFirst({ where:{ id:pendingOrder.session.saleId, tenantId:demo.tenantId } });
  assert.equal(saleBefore.estado, 'BORRADOR');
  const detailIds = pendingOrder.items.map((row) => row.saleDetailId);
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

  const reason = `Cliente canceló antes de tomar CI ${suffix}`;
  const cancelled = await kds.cancelOrder(demo.tenantId, cook, pendingOrder.id, { reason });
  assert.equal(cancelled.orderState, 'CANCELADO');
  assert.equal(cancelled.inventoryReversalRequired, false);

  const [orderAfter, saleAfter, remainingDetails, audit] = await Promise.all([
    prisma.restaurantOrder.findUnique({ where:{ id:pendingOrder.id }, include:{ commands:true } }),
    prisma.comprobanteComercial.findUnique({ where:{ id:saleBefore.id } }),
    prisma.detalleComprobante.findMany({ where:{ id:{ in:detailIds } } }),
    prisma.auditoriaContable.findFirst({
      where:{ tenantId:demo.tenantId, entidad:'RESTAURANT_ORDER', entidadId:pendingOrder.id, accion:'RESTAURANT_ORDER_CANCELLED_KDS' },
      orderBy:{ creadoEn:'desc' }
    })
  ]);
  assert.equal(orderAfter.state, 'CANCELADO');
  assert.equal(orderAfter.commands.every((row) => row.state === 'CANCELADA'), true, 'Cocina y Barra deben cancelarse juntas');
  assert.equal(remainingDetails.length, 0, 'las líneas canceladas no pueden quedar cobrables');
  assert.equal(money(saleAfter.subtotal).toString(), money(money(saleBefore.subtotal).minus(removed.subtotal)).toString());
  assert.equal(money(saleAfter.ivaTotal).toString(), money(money(saleBefore.ivaTotal).minus(removed.iva)).toString());
  assert.equal(money(saleAfter.impoconsumoTotal).toString(), money(money(saleBefore.impoconsumoTotal).minus(removed.impoconsumo)).toString());
  assert.equal(money(saleAfter.total).toString(), money(money(saleBefore.total).minus(removed.total)).toString());
  assert.ok(audit);
  assert.equal(audit.metadata.reason, reason);

  await assert.rejects(
    () => kds.cancelOrder(demo.tenantId, cook, pendingOrder.id, { reason:'Segundo intento' }),
    (error) => error?.code === 'RESTAURANT_V2_KDS_CANCEL_ORDER_STATE_INVALID',
    'doble cancelación debe quedar bloqueada'
  );

  const takenOrder = await addRound(demo.tenantId, waiter, opened.session.id, kitchenMenuItem.id, barMenuItem.id);
  const kitchenCommand = takenOrder.commands.find((row) => row.station === 'COCINA');
  await kds.updateState(demo.tenantId, cook, kitchenCommand.id, 'EN_PREPARACION');

  const afterTake = await prisma.restaurantOrder.findUnique({ where:{ id:takenOrder.id }, include:{ commands:true } });
  assert.equal(afterTake.state, 'EN_PREPARACION', 'Tomar una comanda debe mover el pedido a EN_PREPARACION');
  assert.equal(afterTake.commands.some((row) => row.station === 'COCINA' && row.state === 'EN_PREPARACION'), true);
  assert.equal(afterTake.commands.some((row) => row.station === 'BARRA' && row.state === 'PENDIENTE'), true);

  const afterTakeWorkspace = await kds.workspace(demo.tenantId, cook, { station:'BARRA' });
  const pendingBar = afterTakeWorkspace.commands.find((row) => row.orderId === takenOrder.id || row.order?.id === takenOrder.id);
  assert.ok(pendingBar, 'la estación pendiente restante sigue visible');
  assert.equal(pendingBar.canCancelOrder, false, 'si una estación ya tomó el pedido, ninguna otra debe mostrar Cancelar pedido');

  await assert.rejects(
    () => kds.cancelOrder(demo.tenantId, cook, takenOrder.id, { reason:'No debe permitir después de tomar' }),
    (error) => ['RESTAURANT_V2_KDS_CANCEL_ORDER_STATE_INVALID','RESTAURANT_V2_KDS_CANCEL_COMMAND_FINAL'].includes(error?.code),
    'después de Tomar comanda la cancelación total debe quedar bloqueada'
  );

  const protectedAfter = await prisma.restaurantOrder.findUnique({ where:{ id:takenOrder.id }, include:{ commands:true } });
  assert.equal(protectedAfter.commands.some((row) => row.station === 'COCINA' && row.state === 'EN_PREPARACION'), true);
  assert.equal(protectedAfter.commands.some((row) => row.station === 'BARRA' && row.state === 'PENDIENTE'), true, 'el rechazo no puede modificar estados');

  console.log('Restaurant V2 KDS Order Cancel V98 DB smoke OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
