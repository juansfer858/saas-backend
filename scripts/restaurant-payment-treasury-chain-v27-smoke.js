'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const treasury = require('../src/modules/treasury/treasury.service');
const recentCollections = require('../src/modules/treasury/treasury-recent-collections.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const paymentMethods = require('../src/modules/restaurant/restaurant-payment-methods.service');
const chainRuntime = require('../src/modules/restaurant/restaurant-payment-treasury-chain.public.routes');

function n(value) { return Number(value || 0); }
function closeEnough(a, b) { return Math.abs(n(a) - n(b)) < 0.005; }

async function createSaleTable(tenantId, user, menuItemId, code) {
  const table = await restaurant.createTable(tenantId, { code, name:`Mesa ${code}`, seats:4, posX:20, posY:20 });
  const opened = await restaurant.openTable(tenantId, user, table.id, { guestCount:1 });
  await restaurant.placeWaiterOrder(tenantId, user, opened.session.id, {
    externalRequestId:`CHAIN-${code}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    items:[{ menuItemId, quantity:1 }]
  });
  return { table, opened };
}

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data:{ nombreEmpresa:`Restaurant Treasury Chain ${stamp}`, subdomain:`rest-chain-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data:{ tenantId:tenant.id, nombre:'Cajero Cadena QA', email:`chain-${stamp}@example.com`, password:'not-login', rol:'ADMIN', activo:true }
  });
  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, user);
  });

  const cash = await prisma.cajaBanco.findFirst({ where:{ tenantId:tenant.id, tipo:'CAJA', nombre:'Caja General', activo:true } });
  assert.ok(cash);
  const bank = await treasury.createCajaBanco(tenant.id, {
    tipo:'BANCO', nombre:'Bancolombia QA', banco:'Bancolombia', numeroCuenta:'10697134511', saldoActual:0, activo:true
  });

  const ingredient = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'PRODUCTO', sku:`ING-CHAIN-${stamp}`, nombre:'Ingrediente cadena', unidadMedida:'UND', controlaInventario:true, costoPromedio:0, stockActual:0, precio1:0, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  const dish = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'SERVICIO', sku:`DISH-CHAIN-${stamp}`, nombre:'Plato cadena', unidadMedida:'PORCION', controlaInventario:false, costoPromedio:0, stockActual:0, precio1:13000, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  await prisma.$transaction((tx) => inventory.applyMovement(tx, {
    tenantId:tenant.id, productoId:ingredient.id, tipo:'COMPRA', cantidad:20, costoUnitario:1000, referencia:'CHAIN-SEED'
  }));
  await prisma.consumptionRecipe.create({
    data:{ tenantId:tenant.id, code:`REC-CHAIN-${stamp}`, name:'Receta cadena', outputProductId:dish.id, active:true,
      items:{ create:[{ tenantId:tenant.id, ingredientProductId:ingredient.id, quantity:1, unitLabel:'UND' }] } }
  });
  const menuItem = await restaurant.saveMenuItem(tenant.id, null, {
    productId:dish.id, category:'FUERTES', station:'COCINA', requiresRecipe:true, active:true, sortOrder:10
  });

  let methods = await paymentMethods.listMethods(tenant.id);
  const cashMethod = methods.find((row) => row.kind === 'EFECTIVO' && row.active);
  const transferMethod = methods.find((row) => row.kind === 'TRANSFERENCIA' && row.cajaBancoId === bank.id && row.active);
  assert.ok(cashMethod);
  assert.ok(transferMethod);

  const activeCredit = await paymentMethods.saveMethod(tenant.id, methods.find((row) => row.kind === 'CREDITO')?.id || null, {
    name:'Crédito', kind:'CREDITO', cajaBancoId:null, active:true, sortOrder:900
  });
  assert.equal(activeCredit.kind, 'CREDITO');
  assert.equal(activeCredit.cajaBancoId, null);

  const shift = await restaurant.openCashShift(tenant.id, user.id, { cajaBancoId:cash.id, saldoInicial:50000 });
  assert.equal(shift.estado, 'ABIERTA');

  const cashTable = await createSaleTable(tenant.id, user, menuItem.id, 'CHAIN-E');
  const bankTable = await createSaleTable(tenant.id, user, menuItem.id, 'CHAIN-B');
  const creditTable = await createSaleTable(tenant.id, user, menuItem.id, 'CHAIN-C');

  const paidCash = await paymentMethods.closeTableWithMethod(tenant.id, user, cashTable.table.id, {
    paymentMethodId:cashMethod.id, tipAmount:0, split:{ mode:'NONE' }
  });
  const paidBank = await paymentMethods.closeTableWithMethod(tenant.id, user, bankTable.table.id, {
    paymentMethodId:transferMethod.id, reference:'BCO-778899', tipAmount:0, split:{ mode:'NONE' }
  });

  await assert.rejects(
    () => paymentMethods.closeTableWithMethod(tenant.id, user, creditTable.table.id, {
      paymentMethodId:activeCredit.id, tipAmount:0, split:{ mode:'NONE' }
    }),
    (error) => error?.code === 'RESTAURANT_CREDIT_CUSTOMER_REQUIRED'
  );

  const [cashAfter, bankAfter, directPagoRows] = await Promise.all([
    prisma.cajaBanco.findUnique({ where:{ id:cash.id } }),
    prisma.cajaBanco.findUnique({ where:{ id:bank.id } }),
    prisma.pago.count({ where:{ tenantId:tenant.id, documentoId:{ in:[paidCash.sale.id, paidBank.sale.id] } } })
  ]);
  assert.ok(closeEnough(cashAfter.saldoActual, 13000), 'Efectivo debe incrementar sólo Caja General');
  assert.ok(closeEnough(bankAfter.saldoActual, 13000), 'Transferencia debe incrementar sólo Bancolombia');
  assert.equal(directPagoRows, 0, 'POS contado no debe falsificar filas Pago de Cartera');

  const customer = await prisma.tercero.create({
    data:{ tenantId:tenant.id, tipo:'CLIENTE', tipoDocumento:'CC', identificacion:`CC-${stamp}`, nombre:'Cliente crédito QA', cupoCredito:100000, diasPlazo:30, activo:true }
  });
  const creditSale = await prisma.comprobanteComercial.create({
    data:{ tenantId:tenant.id, tipo:'FACTURA_VENTA', numero:`CR-${stamp}`, estado:'EMITIDO', terceroId:customer.id, creadoPorId:user.id, formaPago:'CREDITO', total:9000, subtotal:9000, saldo:9000 }
  });
  const cartera = await prisma.cartera.create({
    data:{ tenantId:tenant.id, terceroId:customer.id, comprobanteId:creditSale.id, tipo:'CXC', estado:'PENDIENTE', valorOriginal:9000, saldo:9000, referencia:creditSale.numero }
  });
  const receipt = await prisma.comprobanteComercial.create({
    data:{ tenantId:tenant.id, tipo:'RECIBO_CAJA', numero:`RC-${stamp}`, estado:'EMITIDO', documentoOrigenId:creditSale.id, terceroId:customer.id, cajaBancoId:bank.id, creadoPorId:user.id, formaPago:'BANCO', subtotal:9000, total:9000, saldo:0 }
  });
  await prisma.pago.create({
    data:{ tenantId:tenant.id, documentoId:creditSale.id, carteraId:cartera.id, comprobanteTesoreriaId:receipt.id, cajaBancoId:bank.id, userId:user.id, metodoPago:'TRANSFERENCIA', monto:9000, referencia:'ABONO-4455' }
  });
  await prisma.$transaction((tx) => treasury.recordTreasuryMovementInTx(tx, {
    tenantId:tenant.id, userId:user.id, cajaBancoId:bank.id, comprobanteId:receipt.id, tipo:'INGRESO', monto:9000, sign:1, referencia:receipt.numero, concepto:`Pago ${creditSale.numero}`
  }));

  const rows = await recentCollections.listRecentCollections(tenant.id, { limit:20 });
  const cashRecent = rows.find((row) => row.documento?.id === paidCash.sale.id && closeEnough(row.monto, 13000));
  const bankRecent = rows.find((row) => row.documento?.id === paidBank.sale.id && closeEnough(row.monto, 13000));
  const creditCollection = rows.find((row) => row.documento?.id === creditSale.id && closeEnough(row.monto, 9000));
  assert.ok(cashRecent);
  assert.equal(cashRecent.source, 'RESTAURANTE_POS');
  assert.equal(cashRecent.metodoPago, 'EFECTIVO');
  assert.equal(cashRecent.metodoLabel, 'Efectivo');
  assert.equal(cashRecent.cuentaDestino.id, cash.id);

  assert.ok(bankRecent);
  assert.equal(bankRecent.source, 'RESTAURANTE_POS');
  assert.equal(bankRecent.metodoPago, 'TRANSFERENCIA');
  assert.equal(bankRecent.metodoLabel, transferMethod.name);
  assert.equal(bankRecent.cuentaDestino.id, bank.id);
  assert.equal(bankRecent.referencia, 'BCO-778899');

  assert.ok(creditCollection);
  assert.equal(creditCollection.source, 'CARTERA');
  assert.equal(creditCollection.metodoPago, 'TRANSFERENCIA');
  assert.equal(creditCollection.cuentaDestino.id, bank.id);
  assert.equal(creditCollection.referencia, 'ABONO-4455');
  assert.equal(rows.some((row) => row.documento?.id === creditTable.opened.session.saleId), false, 'Crédito no cobrado no es recaudo de Tesorería');

  new Function(chainRuntime.paymentTreasuryChainRuntime);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /authoritativeCashierChain:true/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /legacyGenericAccountSelector:false/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /creditRequiresCustomerPortfolio:true/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /failClosedOnConfigurationError:true/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /eventDrivenMount:true/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /noMutationObserver:true/);
  assert.doesNotMatch(chainRuntime.paymentTreasuryChainRuntime, /MutationObserver/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /cashReceived'\)\?\.defaultValue/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /\/cerrar-con-metodo/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /Cuenta destino del cobro/);
  assert.match(chainRuntime.paymentTreasuryChainRuntime, /stopImmediatePropagation/);

  const panelSource = fs.readFileSync('src/web/panel-integration-extras-core.js', 'utf8');
  const patchedPanel = chainRuntime.patchTreasuryPanelSource(panelSource);
  assert.match(patchedPanel, /\/api\/v1\/tesoreria\/recaudos-recientes\?limit=50/);
  assert.doesNotMatch(patchedPanel, /\/api\/v1\/tesoreria\/pagos\?limit=50/);
  assert.match(patchedPanel, /Cuenta destino/);
  assert.match(patchedPanel, /x\.metodoLabel\|\|x\.metodoPago/);
  assert.match(patchedPanel, /x\.cuentaDestino\?\.nombre/);

  console.log('RESTAURANT PAYMENT → TREASURY CHAIN V27 SMOKE OK');
  console.log(JSON.stringify({
    cashToCashAccount:true,
    transferToBankAccount:true,
    anonymousCreditBlocked:true,
    directPosDoesNotCreateFakePortfolioPayment:true,
    treasuryRecentCollectionsUsesMovements:true,
    exactRestaurantMethodSnapshot:true,
    portfolioCollectionPreserved:true,
    cashierConfiguredMethodsAuthoritative:true,
    genericCashBankSelectorRemoved:true,
    totalUsesCashierCanonicalRenderedValue:true,
    eventDrivenMount:true,
    mutationObserver:false,
    failClosedIfMethodConfigUnavailable:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
