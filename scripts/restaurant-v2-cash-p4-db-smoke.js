'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const base = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const treasury = require('../src/modules/treasury/treasury.service');
const cashV2 = require('../src/modules/restaurant/restaurant-v2-cash.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function makeReadyTable(demo, waiter, zone, suffix, menuItem, sequence) {
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `P4-${sequence}-${suffix}`,
      name: `Mesa Caja P4 ${sequence}`,
      seats: 4,
      assignedWaiterId: waiter.id
    }
  });
  const opened = await base.openTable(demo.tenantId, waiter, table.id, { guestCount: 2 }, V2_OPTIONS);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menuItem.id, sequence, null, V2_OPTIONS);
  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  await base.requestAccount(demo.tenantId, waiter, table.id, V2_OPTIONS);
  return { table, sessionId: opened.session.id, saleId: opened.sale.id };
}

async function main() {
  const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
  const serviceSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');
  const publicSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js', 'utf8');
  const htmlSource = fs.readFileSync('src/web/restaurant-v2-cash.html', 'utf8');
  const uiSource = fs.readFileSync('src/web/restaurant-v2-cash.js', 'utf8');
  const coreSource = fs.readFileSync('src/routes/core.routes.js', 'utf8');

  assert.match(routeSource, /\/v2\/caja\/mesas\/:tableId\/cobrar/);
  assert.match(routeSource, /\/v2\/caja\/turno\/abrir/);
  assert.match(routeSource, /\/v2\/caja\/turno\/cerrar/);
  assert.match(serviceSource, /installOperationalPosMode/);
  assert.match(serviceSource, /splitOwner:\s*'P5'/);
  assert.match(serviceSource, /prepareCreditClose/);
  assert.match(publicSource, /p4-cash-independent/);
  assert.match(coreSource, /restaurantV2CashRouter/);
  assert.match(htmlSource, /COBRAR CUENTA COMPLETA/);
  assert.match(htmlSource, /DIAN no es requisito/);
  assert.match(uiSource, /VANTIX_RESTAURANT_V2_CASH_P4/);
  assert.doesNotMatch(uiSource, /MutationObserver|setInterval|originalSend|res\.send\s*=/);

  assert.throws(
    () => cashV2.assertWholeAccountBoundary({ billingMode: 'INDIVIDUAL', splitMode: null, splitMetadata: null }),
    (error) => error?.code === 'RESTAURANT_V2_CASH_SPLIT_REQUIRES_P5'
  );

  const demo = await ensureRestaurantDemoTenant();
  const [waiter, cashier] = await Promise.all([
    prisma.user.findUnique({ where: { id: demo.users.MESERO } }),
    prisma.user.findUnique({ where: { id: demo.users.CAJERO } })
  ]);
  assert.ok(waiter && cashier);

  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name: `Caja P4 ${suffix}`, sortOrder: 997 } });
  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo: 'CAJA',
    nombre: `Caja P4 ${suffix}`,
    banco: null,
    numeroCuenta: null,
    cuentaContableId: null,
    saldoActual: 0,
    activo: true
  });

  const cashMethodId = crypto.randomUUID();
  const creditMethodId = crypto.randomUUID();
  await prisma.restaurantConfig.upsert({
    where: { tenantId: demo.tenantId },
    create: {
      tenantId: demo.tenantId,
      dianRealEnabled: false,
      allowSimulatedDocumentEquivalent: false,
      paymentMethods: [
        { id: cashMethodId, name: 'Efectivo P4', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 },
        { id: creditMethodId, name: 'Crédito P4', kind: 'CREDITO', cajaBancoId: null, active: true, sortOrder: 20 }
      ]
    },
    update: {
      dianRealEnabled: false,
      allowSimulatedDocumentEquivalent: false,
      paymentMethods: [
        { id: cashMethodId, name: 'Efectivo P4', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 },
        { id: creditMethodId, name: 'Crédito P4', kind: 'CREDITO', cajaBancoId: null, active: true, sortOrder: 20 }
      ]
    }
  });

  const menu = (await base.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  assert.ok(menu.length >= 1, 'el demo debe tener carta operativa');
  const cashTable = await makeReadyTable(demo, waiter, zone, suffix, menu[0], 1);
  const creditTable = await makeReadyTable(demo, waiter, zone, suffix, menu[0], 2);

  const initialWorkspace = await cashV2.workspace(demo.tenantId, cashier);
  assert.equal(initialWorkspace.operation.mode, 'POS_INTERNO');
  assert.equal(initialWorkspace.operation.electronicInvoiceRequired, false);
  assert.equal(initialWorkspace.operation.dianRequired, false);
  assert.equal(initialWorkspace.operation.splitOwner, 'P5');
  assert.equal(initialWorkspace.queue.some((row) => row.table.id === cashTable.table.id && row.readyForCash), true);
  assert.equal(initialWorkspace.shift.own, null);

  let shiftRequired = false;
  try {
    await cashV2.chargeWholeAccount(demo.tenantId, cashier, cashTable.table.id, { paymentMethodId: cashMethodId, tipAmount: 0 });
  } catch (error) {
    shiftRequired = error?.code === 'RESTAURANT_V2_CASH_SHIFT_REQUIRED';
  }
  assert.equal(shiftRequired, true, 'P4 no cobra fuera de turno');

  const openedShift = await cashV2.openShift(demo.tenantId, cashier, { cajaBancoId: cashAccount.id, saldoInicial: 50000 });
  assert.equal(openedShift.shift.estado, 'ABIERTA');

  const cashResult = await cashV2.chargeWholeAccount(demo.tenantId, cashier, cashTable.table.id, {
    paymentMethodId: cashMethodId,
    tipAmount: 0,
    reference: 'P4-EFECTIVO-001'
  });
  assert.equal(cashResult.charged, true);
  assert.equal(cashResult.paymentMethod.kind, 'EFECTIVO');
  assert.equal(cashResult.result.operationMode, 'POS_INTERNO');
  assert.equal(cashResult.result.status.posOperation.electronicInvoiceRequired, false);
  assert.equal(cashResult.result.fiscalDocument.mode, 'POS');

  const [cashSession, cashSale, treasuryRows, cashAsiento, simulatedFiscal] = await Promise.all([
    prisma.restaurantTableSession.findUnique({ where: { id: cashTable.sessionId } }),
    prisma.comprobanteComercial.findUnique({ where: { id: cashTable.saleId } }),
    prisma.movimientoTesoreria.findMany({ where: { tenantId: demo.tenantId, comprobanteId: cashTable.saleId } }),
    prisma.asientoContable.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: cashTable.saleId } }),
    prisma.restaurantFiscalDocument.count({ where: { tenantId: demo.tenantId, saleId: cashTable.saleId, mode: 'SIMULATED' } })
  ]);
  assert.equal(cashSession.state, 'CERRADA');
  assert.equal(cashSession.paymentMethodId, cashMethodId);
  assert.equal(cashSession.paymentMethodKind, 'EFECTIVO');
  assert.equal(cashSession.paymentReference, 'P4-EFECTIVO-001');
  assert.equal(cashSession.cashShiftId, openedShift.shift.id);
  assert.notEqual(cashSale.estado, 'BORRADOR');
  assert.equal(treasuryRows.length, 1, 'un cobro contado produce un solo movimiento de Tesorería');
  assert.ok(cashAsiento, 'el cobro real produce asiento contable');
  assert.equal(simulatedFiscal, 0, 'DIAN apagada no debe dejar documento SIMULATED');

  let duplicateBlocked = false;
  try {
    await cashV2.chargeWholeAccount(demo.tenantId, cashier, cashTable.table.id, { paymentMethodId: cashMethodId });
  } catch (error) {
    duplicateBlocked = ['RESTAURANT_V2_CASH_SESSION_NOT_FOUND', 'RESTAURANT_V2_CASH_SALE_ALREADY_PROCESSED'].includes(error?.code);
  }
  assert.equal(duplicateBlocked, true, 'un segundo cobro de la misma visita debe bloquearse');
  assert.equal(await prisma.movimientoTesoreria.count({ where: { tenantId: demo.tenantId, comprobanteId: cashTable.saleId } }), 1, 'el reintento no duplica Tesorería');

  const customer = await cashV2.createCustomer(demo.tenantId, {
    tipoDocumento: 'CC',
    identificacion: `P4${Date.now()}`,
    nombre: `Cliente Crédito P4 ${suffix}`,
    razonSocial: null,
    direccion: null,
    telefono: '3000000000',
    email: null,
    cupoCredito: 1000000,
    diasPlazo: 15
  });
  const creditResult = await cashV2.chargeWholeAccount(demo.tenantId, cashier, creditTable.table.id, {
    paymentMethodId: creditMethodId,
    tipAmount: 0,
    terceroId: customer.id,
    reference: 'CREDITO-P4-001'
  });
  assert.equal(creditResult.charged, true);
  assert.equal(creditResult.paymentMethod.kind, 'CREDITO');
  assert.equal(creditResult.result.operationMode, 'POS_INTERNO');
  assert.ok(creditResult.credit.dueDate);

  const [creditSession, creditSale, receivable, creditTreasuryRows, creditAsiento, creditSimulatedFiscal] = await Promise.all([
    prisma.restaurantTableSession.findUnique({ where: { id: creditTable.sessionId } }),
    prisma.comprobanteComercial.findUnique({ where: { id: creditTable.saleId } }),
    prisma.cartera.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: creditTable.saleId, terceroId: customer.id, tipo: 'CXC' } }),
    prisma.movimientoTesoreria.findMany({ where: { tenantId: demo.tenantId, comprobanteId: creditTable.saleId } }),
    prisma.asientoContable.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: creditTable.saleId } }),
    prisma.restaurantFiscalDocument.count({ where: { tenantId: demo.tenantId, saleId: creditTable.saleId, mode: 'SIMULATED' } })
  ]);
  assert.equal(creditSession.state, 'CERRADA');
  assert.equal(creditSession.paymentMethodId, creditMethodId);
  assert.equal(creditSession.paymentMethodKind, 'CREDITO');
  assert.equal(creditSession.paymentReference, 'CREDITO-P4-001');
  assert.equal(creditSale.formaPago, 'CREDITO');
  assert.equal(creditSale.terceroId, customer.id);
  assert.ok(receivable, 'crédito genera CXC real');
  assert.equal(creditTreasuryRows.length, 0, 'crédito no inventa ingreso de Caja/Banco');
  assert.ok(creditAsiento, 'venta a crédito conserva asiento contable');
  assert.equal(creditSimulatedFiscal, 0);

  const summary = await cashV2.shiftSummary(demo.tenantId, cashier);
  assert.equal(summary.shift.id, openedShift.shift.id);
  assert.ok(Number(summary.restaurantCashRecorded) > 0);
  const closedShift = await cashV2.closeShift(demo.tenantId, cashier, { saldoFinal: Number(summary.systemCashExpected) });
  assert.equal(closedShift.closed.estado, 'CERRADA');
  assert.equal(Number(closedShift.closed.descuadre), 0);

  console.log(JSON.stringify({
    ok: true,
    module: 'CAJA_V2_P4',
    operationalPos: true,
    dianOptional: true,
    openShiftRequired: true,
    wholeAccountOnly: true,
    splitOwnedByP5: true,
    exactPaymentMethod: true,
    referencePersisted: true,
    treasuryReal: true,
    accountingReal: true,
    duplicateBlocked: true,
    creditCreatesReceivable: true,
    creditDoesNotCreateCashMovement: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());