'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const cash = require('../src/modules/restaurant/restaurant-v2-cash.service');
const splitV2 = require('../src/modules/restaurant/restaurant-v2-split.service');
const treasury = require('../src/modules/treasury/treasury.service');

const options = { sharedFloor:true, optionalSeat:true };

async function createDeliveredTable(tenantId, waiter, operator, menuId, label, quantity = 1) {
  const suffix = crypto.randomUUID();
  const table = await restaurant.createTable(tenantId, {
    code:`V120-${suffix}`,
    name:label,
    seats:4
  });
  const opened = await restaurant.openTable(tenantId, waiter, table.id, { guestCount:2 }, options);
  await identity.setWaiterDraftItem(tenantId, waiter, opened.session.id, menuId, quantity, null, options);
  const sent = await identity.sendWaiterDraft(tenantId, waiter, opened.session.id, options);
  const commands = await prisma.restaurantCommand.findMany({ where:{ tenantId, orderId:sent.id } });
  assert.ok(commands.length > 0, `${label} debe generar Producción`);
  for (const state of ['EN_PREPARACION','LISTA','ENTREGADA']) {
    for (const command of commands) await restaurant.updateCommandState(tenantId, operator, command.id, state);
  }
  await restaurant.requestAccount(tenantId, waiter, table.id, options);
  return { table, opened, sent };
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const tenantId = demo.tenantId;
  const [waiter, cashier] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } }),
    prisma.user.findUnique({ where:{ id:demo.users.CAJERO } })
  ]);
  const menu = (await restaurant.listMenu(tenantId)).find((row) => !row.warning && row.product);
  assert.ok(menu, 'se requiere un producto vendible');

  const suffix = crypto.randomUUID();
  const [cashAccount, bankAccount] = await Promise.all([
    treasury.createCajaBanco(tenantId, { tipo:'CAJA', nombre:`Caja V120 ${suffix}`, saldoActual:0, activo:true }),
    treasury.createCajaBanco(tenantId, { tipo:'BANCO', nombre:`Banco V120 ${suffix}`, banco:'Banco prueba', numeroCuenta:suffix.slice(0,12), saldoActual:0, activo:true })
  ]);
  const transferMethodId = crypto.randomUUID();
  await prisma.restaurantConfig.update({
    where:{ tenantId },
    data:{ paymentMethods:[{
      id:transferMethodId,
      name:'Transferencia V120',
      kind:'TRANSFERENCIA',
      cajaBancoId:bankAccount.id,
      active:true,
      sortOrder:10
    }] }
  });

  const openedShift = await cash.openShift(tenantId, cashier, { cajaBancoId:cashAccount.id, saldoInicial:0 });

  // 1) Cuenta completa por transferencia: Venta contado -> movimiento Tesorería.
  const whole = await createDeliveredTable(tenantId, waiter, cashier, menu.id, 'Mesa transferencia V120', 1);
  const charged = await cash.chargeWholeAccount(tenantId, cashier, whole.table.id, {
    paymentMethodId:transferMethodId,
    tipAmount:0
  });
  assert.equal(charged.charged,true);
  assert.equal(charged.paymentMethod.kind,'TRANSFERENCIA');

  const wholeSession = await prisma.restaurantTableSession.findUnique({ where:{ id:whole.opened.session.id } });
  assert.equal(wholeSession.state, 'CERRADA');
  const wholeSale = await prisma.comprobanteComercial.findUnique({ where:{ id:whole.opened.sale.id } });
  assert.equal(wholeSale.formaPago, 'BANCO');
  assert.equal(Number(wholeSale.saldo),0);
  const wholeMovement = await prisma.movimientoTesoreria.findFirst({
    where:{ tenantId, comprobanteId:wholeSale.id, tipo:'INGRESO', concepto:{ startsWith:'Venta contado' } },
    orderBy:{ creadoEn:'asc' }
  });
  assert.ok(wholeMovement, 'la transferencia completa debe tener movimiento Venta contado');
  assert.equal(Number(wholeMovement.monto),Number(wholeSale.total));

  // 2) División 100% bancaria: no recibe cashShiftId, pero debe entrar al alcance por cierre del cajero.
  const split = await createDeliveredTable(tenantId, waiter, cashier, menu.id, 'Mesa división bancaria V120', 2);
  const prepared = await splitV2.prepare(tenantId, cashier, split.table.id, { mode:'EQUAL', parts:2 });
  assert.equal(prepared.prepared,true);
  await splitV2.payPart(tenantId, cashier, split.table.id, {
    partKey:'P1', paymentMethodId:transferMethodId, reference:'V120-P1'
  });
  const splitClosed = await splitV2.payPart(tenantId, cashier, split.table.id, {
    partKey:'P2', paymentMethodId:transferMethodId, reference:'V120-P2'
  });
  assert.equal(splitClosed.closed,true);
  const splitSession = await prisma.restaurantTableSession.findUnique({ where:{ id:split.opened.session.id } });
  assert.equal(splitSession.state,'CERRADA');
  assert.equal(splitSession.cashShiftId,null,'una división 100% bancaria no depende de cashShiftId');
  const splitPayments = await prisma.pago.findMany({ where:{ tenantId, documentoId:split.opened.sale.id } });
  assert.equal(splitPayments.length,2);

  // Corromper exclusivamente la evidencia financiera por $12.500. Producción y Venta siguen iguales.
  const originalMovementAmount = wholeMovement.monto;
  await prisma.movimientoTesoreria.update({
    where:{ id:wholeMovement.id },
    data:{ monto:Number(originalMovementAmount) + 12500 }
  });

  const summaryBefore = await cash.shiftSummary(tenantId, cashier);
  let mismatch = null;
  try {
    await cash.closeShift(tenantId, cashier, { saldoFinal:Number(summaryBefore.systemCashExpected) });
  } catch (error) {
    mismatch = error;
  }
  assert.ok(mismatch, 'el cierre debe bloquear la diferencia financiera');
  assert.equal(mismatch.code,'RESTAURANT_SHIFT_CLOSE_SALES_PAYMENTS_MISMATCH');
  assert.equal(Number(mismatch.details?.reconciliation?.difference),12500);
  assert.equal(
    (await prisma.aperturaCierreCaja.findUnique({ where:{ id:openedShift.shift.id } })).estado,
    'ABIERTA',
    'un descuadre financiero no puede cerrar el turno'
  );
  assert.ok(
    (mismatch.details?.failures || []).some((entry) => entry.reference === 'Mesa transferencia V120'),
    'debe identificar la mesa de la diferencia'
  );

  // Reparar exactamente la evidencia y comprobar ambos gates.
  await prisma.movimientoTesoreria.update({ where:{ id:wholeMovement.id }, data:{ monto:originalMovementAmount } });
  const summaryAfter = await cash.shiftSummary(tenantId, cashier);
  const closed = await cash.closeShift(tenantId, cashier, { saldoFinal:Number(summaryAfter.systemCashExpected) });
  assert.equal(closed.closed.estado,'CERRADA');
  assert.equal(closed.operationalClose.productionSalesReconciliation.balanced,true);
  assert.equal(Number(closed.operationalClose.productionSalesReconciliation.difference),0);
  assert.ok(closed.operationalClose.productionSalesReconciliation.checkedOperations >= 2,
    'V119 debe incluir la división 100% bancaria');
  assert.equal(closed.operationalClose.salesPaymentsReconciliation.balanced,true);
  assert.equal(Number(closed.operationalClose.salesPaymentsReconciliation.difference),0);
  assert.ok(closed.operationalClose.salesPaymentsReconciliation.checkedOperations >= 2,
    'V120 debe incluir cuenta completa y división bancaria');
  assert.equal(Number(closed.operationalClose.salesPaymentsReconciliation.receivableBalance),0,
    'las operaciones pagadas no deben dejar cartera');

  const audit = await prisma.auditoriaContable.findFirst({
    where:{ tenantId, entidadId:openedShift.shift.id, accion:'RESTAURANT_SHIFT_ALL_TABLES_CLOSED' },
    orderBy:{ creadoEn:'desc' }
  });
  assert.equal(audit?.metadata?.productionSalesReconciliation?.balanced,true);
  assert.equal(audit?.metadata?.salesPaymentsReconciliation?.balanced,true);
  assert.equal(Number(audit?.metadata?.salesPaymentsReconciliation?.difference),0);

  console.log('V120 DB OK: transfer $12.500 blocked, bank-only split included, repair closes at difference 0');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
