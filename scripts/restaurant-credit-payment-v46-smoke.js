'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const credit = require('../src/modules/restaurant/restaurant-credit-payment.service');

function n(value) { return Number(value || 0); }
function closeEnough(a, b) { return Math.abs(n(a) - n(b)) < 0.005; }

async function createSaleTable(tenantId, user, menuItemId, code) {
  const table = await restaurant.createTable(tenantId, { code, name:`Mesa ${code}`, seats:4, posX:20, posY:20 });
  const opened = await restaurant.openTable(tenantId, user, table.id, { guestCount:1 });
  const order = await restaurant.placeWaiterOrder(tenantId, user, opened.session.id, {
    externalRequestId:`CREDIT-${code}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    items:[{ menuItemId, quantity:1 }]
  });
  assert.equal(order.state, 'ENVIADO');
  return { table, opened };
}

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data:{ nombreEmpresa:`Restaurant Credit ${stamp}`, subdomain:`rest-credit-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data:{ tenantId:tenant.id, nombre:'Cajero Crédito QA', email:`credit-${stamp}@example.com`, password:'not-login', rol:'ADMIN', activo:true }
  });
  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, user);
  });

  const customer = await prisma.tercero.create({
    data:{
      tenantId:tenant.id, tipo:'CLIENTE', tipoDocumento:'CC', identificacion:`10${stamp}`,
      nombre:'Cliente Crédito QA', cupoCredito:50000, diasPlazo:30, activo:true
    }
  });
  const lowLimitCustomer = await prisma.tercero.create({
    data:{
      tenantId:tenant.id, tipo:'CLIENTE', tipoDocumento:'CC', identificacion:`20${stamp}`,
      nombre:'Cliente Cupo Bajo QA', cupoCredito:5000, diasPlazo:15, activo:true
    }
  });

  const ingredient = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'PRODUCTO', sku:`ING-CREDIT-${stamp}`, nombre:'Ingrediente Crédito QA', unidadMedida:'UND', controlaInventario:true, costoPromedio:0, stockActual:0, precio1:0, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  const dish = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'SERVICIO', sku:`DISH-CREDIT-${stamp}`, nombre:'Plato Crédito QA', unidadMedida:'PORCION', controlaInventario:false, costoPromedio:0, stockActual:0, precio1:10000, ivaPct:0, impoconsumoPct:0, activo:true }
  });
  await prisma.$transaction((tx) => inventory.applyMovement(tx, {
    tenantId:tenant.id, productoId:ingredient.id, tipo:'COMPRA', cantidad:10, costoUnitario:1000, referencia:'CREDIT-SEED'
  }));
  await prisma.consumptionRecipe.create({
    data:{
      tenantId:tenant.id,
      code:`REC-CREDIT-${stamp}`,
      name:'Receta Crédito QA',
      outputProductId:dish.id,
      active:true,
      items:{ create:[{ tenantId:tenant.id, ingredientProductId:ingredient.id, quantity:1, unitLabel:'UND' }] }
    }
  });
  const menuItem = await restaurant.saveMenuItem(tenant.id, null, {
    productId:dish.id, category:'FUERTES', station:'COCINA', requiresRecipe:true, active:true, sortOrder:10
  });

  const creditTable = await createSaleTable(tenant.id, user, menuItem.id, 'CR1');
  const prepared = await credit.prepareCreditClose(tenant.id, creditTable.table.id, customer.id);
  assert.equal(prepared.customer.id, customer.id);
  assert.equal(prepared.credit.saleTotal, '10000');
  assert.ok(new Date(prepared.credit.dueDate).getTime() > Date.now() + 28 * 86400000, 'debe respetar los 30 días de plazo');

  const draft = await prisma.comprobanteComercial.findUnique({ where:{ id:creditTable.opened.sale.id } });
  assert.equal(draft.terceroId, customer.id);
  assert.equal(draft.formaPago, 'CREDITO');
  assert.equal(draft.cajaBancoId, null);
  assert.ok(draft.fechaVencimiento);

  const closed = await restaurant.closeTable(tenant.id, user, creditTable.table.id, {
    formaPago:'CREDITO', cajaBancoId:null, tipAmount:0, split:{ mode:'NONE' }
  });
  assert.equal(closed.session.state, 'CERRADA');
  assert.equal(closed.sale.formaPago, 'CREDITO');
  assert.equal(closed.sale.terceroId, customer.id);
  assert.ok(closeEnough(closed.sale.saldo, 10000));

  const [tableAfter, cartera, treasuryMovements, ingredientAfter] = await Promise.all([
    prisma.restaurantTable.findUnique({ where:{ id:creditTable.table.id } }),
    prisma.cartera.findFirst({ where:{ tenantId:tenant.id, comprobanteId:closed.sale.id, terceroId:customer.id, tipo:'CXC' } }),
    prisma.movimientoTesoreria.findMany({ where:{ tenantId:tenant.id, comprobanteId:closed.sale.id } }),
    prisma.producto.findUnique({ where:{ id:ingredient.id } })
  ]);
  assert.equal(tableAfter.state, 'LIBRE');
  assert.ok(cartera, 'la venta a crédito debe crear CXC');
  assert.equal(cartera.estado, 'PENDIENTE');
  assert.ok(closeEnough(cartera.valorOriginal, 10000));
  assert.ok(closeEnough(cartera.saldo, 10000));
  assert.equal(treasuryMovements.length, 0, 'crédito no debe mover Caja/Banco al emitir');
  assert.ok(closeEnough(ingredientAfter.stockActual, 9), 'la venta a crédito sí debe consumir inventario');
  assert.ok(closed.sale.asiento && closeEnough(closed.sale.asiento.totalDebito, closed.sale.asiento.totalCredito), 'el asiento debe quedar cuadrado');

  const cargo = await prisma.movimientoCartera.findFirst({ where:{ tenantId:tenant.id, carteraId:cartera.id, tipo:'CARGO' } });
  assert.ok(cargo, 'debe existir movimiento CARGO de cartera');
  assert.ok(closeEnough(cargo.saldoNuevo, 10000));

  const blockedTable = await createSaleTable(tenant.id, user, menuItem.id, 'CR2');
  const blockedBefore = await prisma.comprobanteComercial.findUnique({ where:{ id:blockedTable.opened.sale.id } });
  assert.ok(blockedBefore.terceroId, 'la venta POS nace con el cliente genérico canónico');
  assert.notEqual(blockedBefore.terceroId, lowLimitCustomer.id);
  let limitError = null;
  try {
    await credit.prepareCreditClose(tenant.id, blockedTable.table.id, lowLimitCustomer.id);
  } catch (error) {
    limitError = error;
  }
  assert.equal(limitError?.code, 'RESTAURANT_CREDIT_LIMIT_EXCEEDED');
  const blockedSale = await prisma.comprobanteComercial.findUnique({ where:{ id:blockedTable.opened.sale.id } });
  assert.equal(blockedSale.estado, 'BORRADOR');
  assert.equal(blockedSale.terceroId, blockedBefore.terceroId, 'si supera cupo debe conservar el cliente genérico previo');
  assert.notEqual(blockedSale.terceroId, lowLimitCustomer.id, 'el cliente rechazado no puede quedar asociado');
  assert.notEqual(blockedSale.formaPago, 'CREDITO', 'si supera cupo no debe dejar la venta marcada a crédito');

  console.log('RESTAURANT CREDIT PAYMENT V46 SMOKE OK');
  console.log(JSON.stringify({
    creditButtonBackendReady:true,
    customerRequired:true,
    dueDaysApplied:true,
    creditLimitEnforced:true,
    rejectedCreditLeavesDraftUntouched:true,
    cxcCreated:true,
    carteraChargeCreated:true,
    tableClosedAndFreed:true,
    treasuryMovementOnCredit:0,
    inventoryConsumed:true,
    accountingBalanced:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
