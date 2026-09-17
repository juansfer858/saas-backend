'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const cash = require('../src/modules/restaurant/restaurant-v2-cash.service');
const treasury = require('../src/modules/treasury/treasury.service');

const options = { sharedFloor:true, optionalSeat:true };

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const tenantId = demo.tenantId;
  const waiter = await prisma.user.findUnique({ where:{ id:demo.users.MESERO } });
  const cashier = await prisma.user.findUnique({ where:{ id:demo.users.CAJERO } });
  const menu = (await restaurant.listMenu(tenantId)).find((row) => !row.warning && row.product);
  assert.ok(menu, 'se requiere un producto vendible en la carta demo');

  const suffix = crypto.randomUUID();
  const account = await treasury.createCajaBanco(tenantId, {
    tipo:'CAJA',
    nombre:`Reconcile V119 ${suffix}`,
    saldoActual:0,
    activo:true
  });
  const methodId = crypto.randomUUID();
  await prisma.restaurantConfig.update({
    where:{ tenantId },
    data:{ paymentMethods:[{ id:methodId, name:'Efectivo V119', kind:'EFECTIVO', cajaBancoId:account.id, active:true }] }
  });

  const opened = await cash.openShift(tenantId, cashier, { cajaBancoId:account.id, saldoInicial:0 });
  const table = await restaurant.createTable(tenantId, {
    code:`V119-${suffix}`,
    name:'Mesa reconcile V119',
    seats:2
  });
  const visit = await restaurant.openTable(tenantId, waiter, table.id, { guestCount:1 }, options);
  await identity.setWaiterDraftItem(tenantId, waiter, visit.session.id, menu.id, 1, null, options);
  const sent = await identity.sendWaiterDraft(tenantId, waiter, visit.session.id, options);

  const commands = await prisma.restaurantCommand.findMany({ where:{ tenantId, orderId:sent.id } });
  assert.ok(commands.length > 0, 'el pedido debe generar Producción');
  for (const state of ['EN_PREPARACION','LISTA','ENTREGADA']) {
    for (const command of commands) {
      await restaurant.updateCommandState(tenantId, cashier, command.id, state);
    }
  }

  await restaurant.requestAccount(tenantId, waiter, table.id, options);
  await cash.chargeWholeAccount(tenantId, cashier, table.id, { paymentMethodId:methodId, tipAmount:0 });

  const closedSession = await prisma.restaurantTableSession.findUnique({ where:{ id:visit.session.id } });
  assert.equal(closedSession.state, 'CERRADA');
  assert.equal(closedSession.cashShiftId, opened.shift.id);

  const orderItem = await prisma.restaurantOrderItem.findFirst({
    where:{ tenantId, orderId:sent.id },
    select:{ id:true, saleDetailId:true, lineTotal:true }
  });
  assert.ok(orderItem?.saleDetailId, 'la línea producida debe conservar saleDetailId');
  const saleDetail = await prisma.detalleComprobante.findUnique({ where:{ id:orderItem.saleDetailId } });
  assert.ok(saleDetail, 'debe existir la línea financiera enlazada');
  assert.equal(Number(orderItem.lineTotal), Number(saleDetail.totalLinea));

  const originalLineTotal = orderItem.lineTotal;
  const corrupted = Number(originalLineTotal) + 12500;
  await prisma.restaurantOrderItem.update({ where:{ id:orderItem.id }, data:{ lineTotal:corrupted } });

  const summaryBefore = await cash.shiftSummary(tenantId, cashier);
  const closeInput = { saldoFinal:Number(summaryBefore.systemCashExpected) };
  let mismatch = null;
  try {
    await cash.closeShift(tenantId, cashier, closeInput);
  } catch (error) {
    mismatch = error;
  }
  assert.ok(mismatch, 'el cierre debe rechazar el descuadre');
  assert.equal(mismatch.code, 'RESTAURANT_SHIFT_CLOSE_PRODUCTION_SALES_MISMATCH');
  assert.equal(
    (await prisma.aperturaCierreCaja.findUnique({ where:{ id:opened.shift.id } })).estado,
    'ABIERTA',
    'el turno debe permanecer abierto cuando Producción y Venta no coinciden'
  );
  assert.equal(mismatch.details?.reconciliation?.difference, '12500.00');
  assert.ok(
    (mismatch.details?.failures || []).some((entry) => entry.reference === 'Mesa reconcile V119'),
    'el error debe identificar la mesa responsable'
  );

  await prisma.restaurantOrderItem.update({ where:{ id:orderItem.id }, data:{ lineTotal:originalLineTotal } });
  const summaryAfterRepair = await cash.shiftSummary(tenantId, cashier);
  const closed = await cash.closeShift(tenantId, cashier, { saldoFinal:Number(summaryAfterRepair.systemCashExpected) });
  assert.equal(closed.closed.estado, 'CERRADA');
  assert.equal(closed.operationalClose.productionSalesReconciliation.balanced, true);
  assert.equal(closed.operationalClose.productionSalesReconciliation.difference, '0.00');
  assert.ok(closed.operationalClose.productionSalesReconciliation.checkedOperations >= 1);

  const audit = await prisma.auditoriaContable.findFirst({
    where:{ tenantId, entidadId:opened.shift.id, accion:'RESTAURANT_SHIFT_ALL_TABLES_CLOSED' },
    orderBy:{ creadoEn:'desc' }
  });
  assert.equal(audit?.metadata?.productionSalesReconciliation?.balanced, true);
  assert.equal(audit?.metadata?.productionSalesReconciliation?.difference, '0.00');

  console.log('V119 DB OK: $12.500 blocked, shift preserved, repair closes at difference 0');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
