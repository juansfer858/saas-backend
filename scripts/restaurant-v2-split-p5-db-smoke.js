'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const treasury = require('../src/modules/treasury/treasury.service');
const cashV2 = require('../src/modules/restaurant/restaurant-v2-cash.service');
const splitV2 = require('../src/modules/restaurant/restaurant-v2-split.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function paymentsForSale(tenantId, saleId) {
  return prisma.pago.findMany({
    where: { tenantId, documentoId: saleId },
    select: { id: true, sourceId: true, comprobanteTesoreriaId: true, monto: true },
    orderBy: { creadoEn: 'asc' }
  });
}

async function treasuryCountForPayments(tenantId, payments) {
  const receiptIds = payments.map((row) => row.comprobanteTesoreriaId).filter(Boolean);
  if (!receiptIds.length) return 0;
  return prisma.movimientoTesoreria.count({
    where: { tenantId, comprobanteId: { in: receiptIds } }
  });
}

async function main() {
  const splitRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.routes.js', 'utf8');
  const splitPublic = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.public.routes.js', 'utf8');
  const splitService = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.service.js', 'utf8');
  const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');
  const core = fs.readFileSync('src/routes/core.routes.js', 'utf8');
  const html = fs.readFileSync('src/web/restaurant-v2-split.html', 'utf8');
  const ui = fs.readFileSync('src/web/restaurant-v2-split.js', 'utf8');
  const css = fs.readFileSync('src/web/restaurant-v2-split.css', 'utf8');
  const p3 = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.routes.js', 'utf8');

  assert.match(splitRoutes, /\/v2\/division\/mesas\/:tableId\/preparar/);
  assert.match(splitRoutes, /\/v2\/division\/mesas\/:tableId\/pagar/);
  assert.match(splitPublic, /\/app\/restaurante-v2\/division/);
  assert.match(splitPublic, /restaurant-v2-split\.css/);
  assert.match(splitPublic, /restaurant-v2-split\.js/);
  assert.match(aggregator, /restaurantV2SplitPublicRouter/);
  assert.match(core, /restaurantV2SplitRouter/);
  assert.match(core, /router\.use\('\/restaurante', restaurantV2SplitRouter\)/);
  assert.match(html, /DIVISIÓN P5/);
  assert.match(html, /restaurant-v2-split\.css/);
  assert.match(html, /restaurant-v2-split\.js/);
  assert.match(ui, /VANTIX_RESTAURANT_V2_SPLIT_P5/);
  assert.match(ui, /\/v2\/division\/mesas\/\$\{encodeURIComponent\(S\.tableId\)\}\/preparar/);
  assert.match(ui, /\/v2\/division\/mesas\/\$\{encodeURIComponent\(S\.tableId\)\}\/pagar/);
  assert.doesNotMatch(ui, /MutationObserver|setInterval|originalSend|res\.send\s*=/);
  assert.match(css, /VANTIX_RESTAURANT_V2_SPLIT_P5/);
  assert.match(splitService, /installOperationalPosMode/);
  assert.match(splitService, /registerPartPaymentFinalized/);
  assert.match(p3, /sharedFloor:true,optionalSeat:true/);

  const demo = await ensureRestaurantDemoTenant();
  const [waiter, cashier] = await Promise.all([
    prisma.user.findUnique({ where: { id: demo.users.MESERO } }),
    prisma.user.findUnique({ where: { id: demo.users.CAJERO } })
  ]);
  assert.ok(waiter && cashier, 'el tenant demo necesita Mesero y Cajero');

  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({
    data: { tenantId: demo.tenantId, name: `Split P5 ${suffix}`, sortOrder: 996 }
  });
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `P5-${suffix}`,
      name: `Mesa Split P5 ${suffix}`,
      seats: 4,
      assignedWaiterId: waiter.id
    }
  });
  const menu = (await restaurant.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  assert.ok(menu.length >= 1, 'el demo debe tener carta operativa');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount: 2 }, V2_OPTIONS);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 2, null, V2_OPTIONS);
  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  await restaurant.requestAccount(demo.tenantId, waiter, table.id, V2_OPTIONS);

  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo: 'CAJA',
    nombre: `Caja Split P5 ${suffix}`,
    banco: null,
    numeroCuenta: null,
    cuentaContableId: null,
    saldoActual: 0,
    activo: true
  });
  const cashMethodId = crypto.randomUUID();
  await prisma.restaurantConfig.upsert({
    where: { tenantId: demo.tenantId },
    create: {
      tenantId: demo.tenantId,
      dianRealEnabled: false,
      allowSimulatedDocumentEquivalent: false,
      paymentMethods: [{ id: cashMethodId, name: 'Efectivo P5', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 }]
    },
    update: {
      dianRealEnabled: false,
      allowSimulatedDocumentEquivalent: false,
      paymentMethods: [{ id: cashMethodId, name: 'Efectivo P5', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 }]
    }
  });

  const workspace = await splitV2.workspace(demo.tenantId, cashier);
  assert.equal(workspace.rows.some((row) => row.table.id === table.id), true, 'P5 debe listar la cuenta real');
  const before = await splitV2.detailSummary(demo.tenantId, cashier, table.id);
  assert.equal(before.prepared, false);
  assert.equal(before.sale.id, opened.sale.id);
  assert.ok(before.items.length >= 1);

  const prepared = await splitV2.prepare(demo.tenantId, cashier, table.id, { mode: 'EQUAL', parts: 2 });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.mode, 'EQUAL');
  assert.equal(prepared.parts.length, 2);
  assert.equal(prepared.sale.id, opened.sale.id, 'División no crea una venta paralela');
  assert.equal(prepared.operation.mode, 'POS_INTERNO');
  assert.equal(prepared.operation.dianRequired, false);
  assert.equal(prepared.operation.electronicInvoiceRequired, false);

  const preparedAgain = await splitV2.prepare(demo.tenantId, cashier, table.id, { mode: 'EQUAL', parts: 2 });
  assert.equal(preparedAgain.prepared, true, 'preparar debe ser idempotente');
  assert.equal(preparedAgain.existingPlan, true);

  await cashV2.openShift(demo.tenantId, cashier, { cajaBancoId: cashAccount.id, saldoInicial: 0 });
  const first = await splitV2.payPart(demo.tenantId, cashier, table.id, {
    partKey: 'P1', paymentMethodId: cashMethodId, reference: 'P5-PARTE-1'
  });
  assert.equal(first.parts.find((part) => part.key === 'P1').paid, true);
  assert.equal(first.closed, false);
  assert.ok(Number(first.remaining) > 0);

  const paymentsAfterFirst = await paymentsForSale(demo.tenantId, opened.sale.id);
  assert.equal(paymentsAfterFirst.length, 1, 'la primera parte crea un único Pago vinculado a la venta');
  assert.ok(paymentsAfterFirst[0].comprobanteTesoreriaId, 'el pago debe generar su RECIBO_CAJA');
  assert.equal(await treasuryCountForPayments(demo.tenantId, paymentsAfterFirst), 1, 'la primera parte genera un movimiento de Tesorería a través de su recibo');

  const firstAgain = await splitV2.payPart(demo.tenantId, cashier, table.id, {
    partKey: 'P1', paymentMethodId: cashMethodId, reference: 'P5-PARTE-1-REINTENTO'
  });
  assert.equal(firstAgain.parts.find((part) => part.key === 'P1').paid, true);
  const paymentsAfterRetry = await paymentsForSale(demo.tenantId, opened.sale.id);
  assert.equal(paymentsAfterRetry.length, 1, 'reintentar una parte pagada no crea otro Pago');
  assert.equal(await treasuryCountForPayments(demo.tenantId, paymentsAfterRetry), 1, 'reintentar una parte pagada no duplica Tesorería');

  const final = await splitV2.payPart(demo.tenantId, cashier, table.id, {
    partKey: 'P2', paymentMethodId: cashMethodId, reference: 'P5-PARTE-2'
  });
  assert.equal(final.closed, true);
  assert.equal(Number(final.remaining), 0);

  const [closedSession, freedTable, sale, sessionPayments, salePayments, saleAccountingEntry, simulatedFiscal] = await Promise.all([
    prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } }),
    prisma.restaurantTable.findUnique({ where: { id: table.id } }),
    prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } }),
    prisma.restaurantSessionPayment.findMany({ where: { tenantId: demo.tenantId, sessionId: opened.session.id } }),
    paymentsForSale(demo.tenantId, opened.sale.id),
    prisma.asientoContable.findFirst({ where: { tenantId: demo.tenantId, comprobanteId: opened.sale.id } }),
    prisma.restaurantFiscalDocument.count({ where: { tenantId: demo.tenantId, saleId: opened.sale.id, mode: 'SIMULATED' } })
  ]);
  const receiptIds = salePayments.map((row) => row.comprobanteTesoreriaId).filter(Boolean);
  const [treasuryRows, receiptAccountingEntries] = await Promise.all([
    prisma.movimientoTesoreria.findMany({ where: { tenantId: demo.tenantId, comprobanteId: { in: receiptIds } } }),
    prisma.asientoContable.count({ where: { tenantId: demo.tenantId, comprobanteId: { in: receiptIds } } })
  ]);

  assert.equal(closedSession.state, 'CERRADA');
  assert.equal(freedTable.state, 'LIBRE');
  assert.equal(sale.estado, 'PAGADO_TOTAL');
  assert.equal(Number(sale.saldo), 0);
  assert.equal(sessionPayments.length, 2, 'deben existir exactamente dos partes pagadas');
  assert.equal(salePayments.length, 2, 'la venta debe tener exactamente dos abonos reales');
  assert.equal(receiptIds.length, 2, 'cada abono debe tener su recibo de Tesorería');
  assert.equal(treasuryRows.length, 2, 'cada recibo real genera un único movimiento de Tesorería');
  assert.equal(receiptAccountingEntries, 2, 'cada recibo real genera su asiento de pago');
  assert.ok(saleAccountingEntry, 'la venta conserva su asiento contable de emisión');
  assert.equal(simulatedFiscal, 0, 'DIAN apagada no genera documento SIMULATED');

  console.log(JSON.stringify({
    ok: true,
    module: 'DIVISION_V2_P5',
    publicSurfaceMounted: true,
    apiMounted: true,
    assetsComplete: true,
    realPostgres: true,
    sameSale: true,
    splitEqual: true,
    partialPayments: true,
    receiptChainValidated: true,
    duplicatePartBlocked: true,
    treasuryReal: true,
    accountingReal: true,
    closesOnlyAtZero: true,
    dianOptional: true,
    p3SharedFloorPreserved: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());