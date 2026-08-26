const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const consumption = require('../src/modules/consumption/consumption.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const liveTables = require('../src/modules/restaurant/restaurant-live-tables.service');
const theme = require('../src/modules/restaurant/restaurant-theme.service');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');

const n = (v) => Number(v || 0);
const near = (a, b) => Math.abs(n(a) - n(b)) < .005;

async function assignRole(tenantId, userId, code) {
  const role = await prisma.rbacRole.findFirst({ where: { tenantId, code, active: true } });
  assert.ok(role, `Role ${code} must exist`);
  await prisma.rbacUserRole.create({ data: { tenantId, userId, roleId: role.id } });
}

async function main() {
  installRestaurantRbac();
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:`La Riel QA ${stamp}`, subdomain:`la-riel-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const admin = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Admin La Riel', email:`admin-${stamp}@qa.local`, password:'not-login', rol:'ADMIN' } });
  const waiter = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Mesero La Riel', email:`mesero-${stamp}@qa.local`, password:'not-login', rol:'MESERO' } });
  const kitchen = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Cocina La Riel', email:`cocina-${stamp}@qa.local`, password:'not-login', rol:'COCINA' } });
  const cashier = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Caja La Riel', email:`caja-${stamp}@qa.local`, password:'not-login', rol:'CAJERO' } });

  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, admin);
  });
  await assignRole(tenant.id, waiter.id, 'MESERO');
  await assignRole(tenant.id, kitchen.id, 'COCINA');
  await assignRole(tenant.id, cashier.id, 'CAJERO');

  const ingredient = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'PRODUCTO', sku:`ING-${stamp}`, nombre:'Ingrediente La Riel', unidadMedida:'UND', controlaInventario:true, costoPromedio:0, stockActual:0, precio1:0, ivaPct:0, impoconsumoPct:0 }
  });
  const dish = await prisma.producto.create({
    data:{ tenantId:tenant.id, tipo:'SERVICIO', sku:`DISH-${stamp}`, nombre:'Plato La Riel', unidadMedida:'PORCION', controlaInventario:false, costoPromedio:0, stockActual:0, precio1:15000, ivaPct:0, impoconsumoPct:0 }
  });
  await prisma.$transaction((tx) => inventory.applyMovement(tx, { tenantId:tenant.id, productoId:ingredient.id, tipo:'COMPRA', cantidad:20, costoUnitario:2000, referencia:'IDENTITY-QA' }));
  await consumption.createRecipe(tenant.id, { code:`REC-${stamp}`, name:'Receta La Riel', outputProductId:dish.id, items:[{ ingredientProductId:ingredient.id, quantity:1, unitLabel:'UND' }] });
  const menu = await restaurant.saveMenuItem(tenant.id, null, { productId:dish.id, category:'FUERTES', station:'COCINA', requiresRecipe:true, active:true, sortOrder:1 });
  assert.equal(menu.recipeConfigured, true);

  const savedTheme = await theme.saveTheme(tenant.id, admin.id, {
    restaurantName:'Restaurante La Riel QA',
    tokens:{ ember:'#123456', brass:'#654321' },
    typography:{ display:'Arial, sans-serif' }
  });
  assert.equal(savedTheme.restaurantName, 'Restaurante La Riel QA');
  assert.equal(savedTheme.tokens.ember, '#123456');
  assert.equal(savedTheme.typography.display, theme.PANEL_FONT);
  assert.equal(savedTheme.typography.body, theme.PANEL_FONT);
  assert.equal(savedTheme.typography.mono, theme.PANEL_FONT);
  assert.equal(savedTheme.typographyLockedToPanel, true);
  assert.equal(await prisma.auditoriaContable.count({ where:{ tenantId:tenant.id, entidad:'RESTAURANT_THEME' } }), 1);

  const table = await restaurant.createTable(tenant.id, { code:'M1', name:'Mesa La Riel', seats:4, assignedWaiterId:waiter.id, posX:48, posY:52 });
  const opened = await restaurant.openTable(tenant.id, waiter, table.id, { guestCount:2 });
  assert.equal(opened.sale.estado, 'BORRADOR');

  let draft = await identity.setWaiterDraftItem(tenant.id, waiter, opened.session.id, menu.id, 1);
  assert.equal(draft.order.state, 'BORRADOR');
  assert.equal(draft.order.items.length, 1);
  assert.equal(draft.sale.id, opened.sale.id);
  assert.equal(draft.sale.detalles.length, 1);
  assert.ok(near(draft.sale.total, 15000));
  const liveFloor = await liveTables.listTablesLive(tenant.id, waiter);
  assert.equal(liveFloor.length, 1);
  assert.equal(liveFloor[0].activeSession.sale.id, opened.sale.id);
  assert.ok(near(liveFloor[0].activeSession.sale.total, 15000));

  const sent = await identity.sendWaiterDraft(tenant.id, waiter, opened.session.id);
  assert.equal(sent.state, 'ENVIADO');
  assert.equal(sent.commands.length, 1);
  assert.equal(sent.commands[0].station, 'COCINA');
  const kitchenNow = await restaurant.listCommands(tenant.id, kitchen, {});
  assert.ok(kitchenNow.some((row) => row.orderId === sent.id && row.station === 'COCINA'));

  const qrContext = await identity.publicQrContext(table.qrToken);
  assert.equal(qrContext.theme.tokens.ember, '#123456');
  assert.equal(qrContext.theme.typography.display, theme.PANEL_FONT);
  assert.equal(qrContext.restaurantName, 'Restaurante La Riel QA');
  const qrOrder = await restaurant.placeQrOrder(table.qrToken, { confirmedTotal:15000, items:[{ menuItemId:menu.id, quantity:1 }], externalRequestId:`QR-ID-${stamp}` });
  assert.equal(qrOrder.source, 'QR');
  const kitchenAfterQr = await restaurant.listCommands(tenant.id, kitchen, {});
  const qrCommand = kitchenAfterQr.find((row) => row.orderId === qrOrder.id);
  assert.ok(qrCommand);
  assert.equal(qrCommand.order.source, 'QR');

  const preparing = await restaurant.updateCommandState(tenant.id, kitchen, sent.commands[0].id, 'EN_PREPARACION');
  assert.equal(preparing.command.state, 'EN_PREPARACION');
  const ready = await restaurant.updateCommandState(tenant.id, kitchen, sent.commands[0].id, 'LISTA');
  assert.equal(ready.command.state, 'LISTA');

  const waiterContext = await identity.uiContext(tenant.id, waiter);
  assert.equal(waiterContext.theme.tokens.ember, '#123456');
  assert.equal(waiterContext.theme.restaurantName, 'Restaurante La Riel QA');
  assert.equal(waiterContext.theme.typography.display, theme.PANEL_FONT);
  assert.equal(waiterContext.polling.kdsMs, 2000);

  const waiterPerms = new Set(waiterContext.permissions);
  assert.equal(waiterPerms.has('MESAS.VER'), true);
  assert.equal(waiterPerms.has('PEDIDOS.CREAR'), true);
  assert.equal(waiterPerms.has('COMANDAS.EDITAR'), false);
  assert.equal(waiterPerms.has('TESORERIA.CERRAR'), false);
  const kitchenContext = await identity.uiContext(tenant.id, kitchen);
  assert.equal(new Set(kitchenContext.permissions).has('COMANDAS.EDITAR'), true);
  assert.equal(new Set(kitchenContext.permissions).has('MESAS.VER'), false);

  const caja = await prisma.cajaBanco.findFirst({ where:{ tenantId:tenant.id, tipo:'CAJA', activo:true } });
  assert.ok(caja);
  const shift = await restaurant.openCashShift(tenant.id, cashier.id, { cajaBancoId:caja.id, saldoInicial:100000 });
  const stockBefore = await prisma.producto.findUnique({ where:{ id:ingredient.id } });
  const closed = await identity.closeTableGuarded(tenant.id, cashier, table.id, { formaPago:'EFECTIVO', cajaBancoId:caja.id, tipAmount:0, split:{ mode:'NONE' } });
  assert.ok(near(closed.sale.total, 30000));
  const stockAfter = await prisma.producto.findUnique({ where:{ id:ingredient.id } });
  assert.ok(near(n(stockBefore.stockActual) - n(stockAfter.stockActual), 2));
  const cash = await identity.cashShiftSummary(tenant.id, cashier.id, shift.id);
  assert.ok(near(cash.paymentBreakdown.cashSales, 30000));
  assert.ok(near(cash.paymentBreakdown.electronicSales, 0));
  assert.ok(near(cash.systemCashExpected, 130000));
  const physicalCount = 130000;
  const difference = physicalCount - n(cash.systemCashExpected);
  assert.ok(near(difference, 0));
  const shiftClosed = await restaurant.closeCashShift(tenant.id, cashier.id, shift.id, { saldoFinal:physicalCount });
  assert.ok(near(shiftClosed.closed.descuadre, 0));

  console.log('RESTAURANT IDENTITY CONNECTED ACCEPTANCE OK');
  console.log(JSON.stringify({
    ID_AC01_fiveSurfacesRealData:true,
    ID_AC02_waiterToKdsImmediate:true,
    ID_AC03_qrOriginPreserved:true,
    ID_AC04_singleTenantTheme:true,
    ID_AC04_panelTypographyLocked:true,
    ID_AC05_coreRbacRail:true,
    ID_AC06_realCashDifference:true,
    saleTotal:n(closed.sale.total),
    expectedDrawer:n(cash.systemCashExpected),
    physicalDifference:difference
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
