'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const treasury = require('../src/modules/treasury/treasury.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const paymentMethods = require('../src/modules/restaurant/restaurant-payment-methods.service');
const splitReport = require('../src/modules/restaurant/restaurant-split-report.service');

function n(value) { return Number(value || 0); }
function closeEnough(a, b) { return Math.abs(n(a) - n(b)) < 0.005; }
function balanced(journal) { return journal && closeEnough(journal.totalDebito, journal.totalCredito); }

async function createSaleTable(tenantId, user, menuItemId, code) {
  const table = await restaurant.createTable(tenantId, { code, name:`Mesa ${code}`, seats:4, posX:20, posY:20 });
  const opened = await restaurant.openTable(tenantId, user, table.id, { guestCount:1 });
  const order = await restaurant.placeWaiterOrder(tenantId, user, opened.session.id, {
    externalRequestId:`PAYMENT-METHOD-${code}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    items:[{ menuItemId, quantity:1 }]
  });
  assert.equal(order.state, 'ENVIADO');
  return { table, opened, order };
}

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data:{ nombreEmpresa:`Restaurant Payment Methods ${stamp}`, subdomain:`rest-pay-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data:{ tenantId:tenant.id, nombre:'Cajero QA', email:`cashier-${stamp}@example.com`, password:'not-login', rol:'ADMIN', activo:true }
  });
  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, user);
  });

  const cash = await prisma.cajaBanco.findFirst({ where:{ tenantId:tenant.id, tipo:'CAJA', nombre:'Caja General', activo:true } });
  assert.ok(cash, 'Caja General debe existir');
  const bank = await treasury.createCajaBanco(tenant.id, {
    tipo:'BANCO', nombre:'Nequi QA', banco:'Nequi', numeroCuenta:'3000000000', saldoActual:0, activo:true
  });

  const ingredient = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'PRODUCTO', sku:`ING-${stamp}`, nombre:'Ingrediente QA', unidadMedida:'UND', controlaInventario:true, costoPromedio:0, stockActual:0, precio1:0, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  const dish = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'SERVICIO', sku:`DISH-${stamp}`, nombre:'Plato QA', unidadMedida:'PORCION', controlaInventario:false, costoPromedio:0, stockActual:0, precio1:10000, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  await prisma.$transaction((tx) => inventory.applyMovement(tx, {
    tenantId:tenant.id, productoId:ingredient.id, tipo:'COMPRA', cantidad:20, costoUnitario:1000, referencia:'PAYMENT-METHOD-SEED'
  }));
  const recipe = await prisma.consumptionRecipe.create({
    data:{ tenantId:tenant.id, code:`REC-${stamp}`, name:'Receta Plato QA', outputProductId:dish.id, active:true,
      items:{ create:[{ tenantId:tenant.id, ingredientProductId:ingredient.id, quantity:1, unitLabel:'UND' }] } }
  });
  assert.ok(recipe.id);
  const menuItem = await restaurant.saveMenuItem(tenant.id, null, {
    productId:dish.id, category:'FUERTES', station:'COCINA', requiresRecipe:true, active:true, sortOrder:10
  });

  let methods = await paymentMethods.listMethods(tenant.id);
  const cashMethod = methods.find((row) => row.kind === 'EFECTIVO' && row.active);
  const transferMethod = methods.find((row) => row.kind === 'TRANSFERENCIA' && row.cajaBancoId === bank.id && row.active);
  const creditMethod = methods.find((row) => row.kind === 'CREDITO');
  assert.ok(cashMethod, 'Debe crearse Efectivo desde Caja General');
  assert.ok(transferMethod, 'Debe crearse Nequi como transferencia desde Banco activo');
  assert.equal(creditMethod?.active, false, 'Crédito no puede quedar activo por defecto');

  const cardMethod = await paymentMethods.saveMethod(tenant.id, null, {
    name:'Datáfono QA', kind:'TARJETA', cajaBancoId:bank.id, active:true, sortOrder:40
  });
  assert.equal(cardMethod.kind, 'TARJETA');
  assert.equal(cardMethod.cajaBancoId, bank.id);

  const shift = await restaurant.openCashShift(tenant.id, user.id, { cajaBancoId:cash.id, saldoInicial:50000 });
  assert.equal(shift.estado, 'ABIERTA');

  const cashTable = await createSaleTable(tenant.id, user, menuItem.id, 'E1');
  const transferTable = await createSaleTable(tenant.id, user, menuItem.id, 'T1');
  const cardTable = await createSaleTable(tenant.id, user, menuItem.id, 'C1');

  const paidCash = await paymentMethods.closeTableWithMethod(tenant.id, user, cashTable.table.id, {
    paymentMethodId:cashMethod.id, tipAmount:0, split:{ mode:'NONE' }
  });
  const paidTransfer = await paymentMethods.closeTableWithMethod(tenant.id, user, transferTable.table.id, {
    paymentMethodId:transferMethod.id, reference:'NEQUI-4821', tipAmount:0, split:{ mode:'NONE' }
  });
  const paidCard = await paymentMethods.closeTableWithMethod(tenant.id, user, cardTable.table.id, {
    paymentMethodId:cardMethod.id, reference:'DATAFONO-7733', tipAmount:0, split:{ mode:'NONE' }
  });

  for (const result of [paidCash, paidTransfer, paidCard]) {
    assert.equal(result.session.state, 'CERRADA');
    assert.equal(result.session.cashShiftId, shift.id, 'Todo cobro procesado por Caja debe pertenecer al turno, incluso electrónico');
    assert.ok(result.sale.asiento && balanced(result.sale.asiento), 'Cada venta debe terminar en un AU cuadrado');
  }
  assert.equal(paidCash.session.paymentMethodLabel, 'Efectivo');
  assert.equal(paidTransfer.session.paymentMethodLabel, 'Nequi QA');
  assert.equal(paidTransfer.session.paymentMethodKind, 'TRANSFERENCIA');
  assert.equal(paidTransfer.session.paymentReference, 'NEQUI-4821');
  assert.equal(paidCard.session.paymentMethodLabel, 'Datáfono QA');
  assert.equal(paidCard.session.paymentMethodKind, 'TARJETA');

  const summary = await splitReport.cashShiftSummary(tenant.id, user.id, shift.id);
  assert.ok(closeEnough(summary.paymentBreakdown.cashSales, 10000));
  assert.ok(closeEnough(summary.paymentBreakdown.transferSales, 10000));
  assert.ok(closeEnough(summary.paymentBreakdown.cardSales, 10000));
  assert.ok(closeEnough(summary.paymentBreakdown.electronicSales, 20000));
  assert.ok(closeEnough(summary.paymentBreakdown.restaurantTotal, 30000));
  assert.ok(closeEnough(summary.systemCashExpected, 60000), 'Efectivo esperado sólo debe sumar el cobro físico al fondo inicial');
  assert.ok(summary.paymentBreakdown.byMethod.some((row) => row.label === 'Efectivo' && closeEnough(row.total, 10000)));
  assert.ok(summary.paymentBreakdown.byMethod.some((row) => row.label === 'Nequi QA' && row.kind === 'TRANSFERENCIA' && closeEnough(row.total, 10000)));
  assert.ok(summary.paymentBreakdown.byMethod.some((row) => row.label === 'Datáfono QA' && row.kind === 'TARJETA' && closeEnough(row.total, 10000)));

  const [cashAfter, bankAfter, ingredientAfter] = await Promise.all([
    prisma.cajaBanco.findUnique({ where:{ id:cash.id } }),
    prisma.cajaBanco.findUnique({ where:{ id:bank.id } }),
    prisma.producto.findUnique({ where:{ id:ingredient.id } })
  ]);
  assert.ok(closeEnough(cashAfter.saldoActual, 10000));
  assert.ok(closeEnough(bankAfter.saldoActual, 20000));
  assert.ok(closeEnough(ingredientAfter.stockActual, 17), 'Las tres ventas deben consumir tres unidades de receta');

  const closedShift = await treasury.closeCashSession(tenant.id, user.id, shift.id, { saldoFinal:60000 });
  assert.equal(closedShift.estado, 'CERRADA');
  assert.ok(closeEnough(closedShift.descuadre, 0));

  const ui = fs.readFileSync('src/web/restaurant-payment-methods-ui.js', 'utf8');
  const routes = fs.readFileSync('src/modules/restaurant/restaurant-visit-payments.routes.js', 'utf8');
  const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-visit.public.routes.js', 'utf8');
  new Function(ui);
  assert.match(ui, /Gestionar métodos/);
  assert.match(ui, /Transferencias \/ QR/);
  assert.match(ui, /Reporte de cierre de caja/);
  assert.match(ui, /Efectivo esperado/);
  assert.match(ui, /\/cerrar-con-metodo/);
  assert.match(routes, /\/metodos-pago/);
  assert.match(routes, /\/caja\/turnos\/:id\/cerrar/);
  assert.match(publicRoutes, /restaurant-payment-methods-ui\.js/);

  console.log('RESTAURANT PAYMENT METHODS + CASH CLOSE REPORT SMOKE OK');
  console.log(JSON.stringify({
    configurablePaymentMethods:true,
    defaultCreditInactive:true,
    cash:summary.paymentBreakdown.cashSales.toString(),
    transfers:summary.paymentBreakdown.transferSales.toString(),
    cards:summary.paymentBreakdown.cardSales.toString(),
    electronic:summary.paymentBreakdown.electronicSales.toString(),
    shiftCashExpected:summary.systemCashExpected.toString(),
    shiftDifference:closedShift.descuadre.toString(),
    transferAndCardBelongToShift:true,
    accountingBalanced:true,
    closeReportUi:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
