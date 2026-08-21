const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const consumption = require('../src/modules/consumption/consumption.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');

function n(value) { return Number(value || 0); }
function closeEnough(a, b) { return Math.abs(n(a) - n(b)) < 0.005; }
function balanced(journal) { return journal && closeEnough(journal.totalDebito, journal.totalCredito); }

async function assignRole(tenantId, user, roleCode) {
  const role = await prisma.rbacRole.findFirst({ where: { tenantId, code: roleCode, active: true } });
  assert.ok(role, `RBAC role ${roleCode} must exist`);
  await prisma.rbacUserRole.upsert({
    where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id } },
    create: { tenantId, userId: user.id, roleId: role.id },
    update: {}
  });
}

async function product(tenantId, stamp, data) {
  return prisma.producto.create({
    data: {
      tenantId,
      tipo: data.tipo || 'PRODUCTO',
      sku: `${data.sku}-${stamp}`,
      nombre: data.nombre,
      unidadMedida: data.unidadMedida || 'UND',
      controlaInventario: data.controlaInventario !== false,
      costoPromedio: 0,
      stockActual: 0,
      precio1: data.precio1 || 0,
      ivaPct: 0,
      impoconsumoPct: 0,
      activo: true
    }
  });
}

async function seedStock(tenantId, productoId, quantity, cost, ref) {
  return prisma.$transaction((tx) => inventory.applyMovement(tx, {
    tenantId,
    productoId,
    tipo: 'COMPRA',
    cantidad: quantity,
    costoUnitario: cost,
    referencia: ref
  }));
}

async function main() {
  installRestaurantRbac();
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Restaurante Fase2 QA ${stamp}`,
      subdomain: `rest-phase2-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });

  const users = {};
  for (const [role, name] of [
    ['ADMIN', 'Admin QA'],
    ['MESERO', 'Mesero QA'],
    ['COCINA', 'Cocina QA'],
    ['BARRA', 'Barra QA'],
    ['CAJERO', 'Cajero QA']
  ]) {
    users[role] = await prisma.user.create({
      data: { tenantId: tenant.id, nombre: name, email: `${role.toLowerCase()}-${stamp}@example.com`, password: 'not-login', rol: role, activo: true }
    });
  }

  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, users.ADMIN);
  });
  for (const role of ['MESERO', 'COCINA', 'BARRA', 'CAJERO']) await assignRole(tenant.id, users[role], role);

  const bread = await product(tenant.id, stamp, { sku: 'ING-PAN', nombre: 'Pan QA' });
  const meat = await product(tenant.id, stamp, { sku: 'ING-CARNE', nombre: 'Carne QA' });
  const lemon = await product(tenant.id, stamp, { sku: 'ING-LIMON', nombre: 'Limón QA' });
  const dessertBase = await product(tenant.id, stamp, { sku: 'ING-POSTRE', nombre: 'Base postre QA' });
  await seedStock(tenant.id, bread.id, 20, 1000, 'REST-QA-PAN');
  await seedStock(tenant.id, meat.id, 20, 4000, 'REST-QA-CARNE');
  await seedStock(tenant.id, lemon.id, 40, 300, 'REST-QA-LIMON');
  await seedStock(tenant.id, dessertBase.id, 20, 2000, 'REST-QA-POSTRE');

  const dish = await product(tenant.id, stamp, { sku: 'MENU-FUERTE', nombre: 'Hamburguesa QA', tipo: 'SERVICIO', controlaInventario: false, precio1: 20000 });
  const drink = await product(tenant.id, stamp, { sku: 'MENU-BEBIDA', nombre: 'Limonada QA', tipo: 'SERVICIO', controlaInventario: false, precio1: 6000 });
  const dessert = await product(tenant.id, stamp, { sku: 'MENU-POSTRE', nombre: 'Postre QA', tipo: 'SERVICIO', controlaInventario: false, precio1: 8000 });

  await consumption.createRecipe(tenant.id, {
    code: `REC-DISH-${stamp}`, name: 'Receta Hamburguesa QA', outputProductId: dish.id,
    items: [{ ingredientProductId: bread.id, quantity: 1, unitLabel: 'UND' }, { ingredientProductId: meat.id, quantity: 1, unitLabel: 'UND' }]
  });
  await consumption.createRecipe(tenant.id, {
    code: `REC-DRINK-${stamp}`, name: 'Receta Limonada QA', outputProductId: drink.id,
    items: [{ ingredientProductId: lemon.id, quantity: 2, unitLabel: 'UND' }]
  });
  await consumption.createRecipe(tenant.id, {
    code: `REC-DESSERT-${stamp}`, name: 'Receta Postre QA', outputProductId: dessert.id,
    items: [{ ingredientProductId: dessertBase.id, quantity: 1, unitLabel: 'UND' }]
  });

  const dishMenu = await restaurant.saveMenuItem(tenant.id, null, { productId: dish.id, category: 'FUERTES', station: 'COCINA', requiresRecipe: true, active: true, sortOrder: 10 });
  const drinkMenu = await restaurant.saveMenuItem(tenant.id, null, { productId: drink.id, category: 'BEBIDAS', station: 'BARRA', requiresRecipe: true, active: true, sortOrder: 20 });
  const dessertMenu = await restaurant.saveMenuItem(tenant.id, null, { productId: dessert.id, category: 'POSTRES', station: 'POSTRES', requiresRecipe: true, active: true, sortOrder: 30 });
  assert.equal(dishMenu.recipeConfigured, true);
  assert.equal(drinkMenu.recipeConfigured, true);
  assert.equal(dessertMenu.recipeConfigured, true);

  const table = await restaurant.createTable(tenant.id, { code: 'M1', name: 'Mesa 1', seats: 4, assignedWaiterId: users.MESERO.id, posX: 40, posY: 40 });
  const opened = await restaurant.openTable(tenant.id, users.MESERO, table.id, { guestCount: 2 });
  assert.equal(opened.sale.estado, 'BORRADOR');
  assert.equal(opened.table.state, 'OCUPADA');

  // AC-01: waiter order creates one command per station, all in simulated mode, on the same sale draft.
  const waiterOrder = await restaurant.placeWaiterOrder(tenant.id, users.MESERO, opened.session.id, {
    externalRequestId: `WAITER-${stamp}`,
    items: [{ menuItemId: dishMenu.id, quantity: 1 }, { menuItemId: drinkMenu.id, quantity: 1 }]
  });
  assert.equal(waiterOrder.source, 'MESERO');
  assert.deepEqual(new Set(waiterOrder.commands.map((c) => c.station)), new Set(['COCINA', 'BARRA']));
  assert.ok(waiterOrder.commands.every((c) => c.printMode === 'SIMULATED_SCREEN'));
  assert.ok(waiterOrder.commands.every((c) => c.simulationRecord?.watermark === 'COMANDA SIMULADA — NO IMPRESA EN HARDWARE'));
  let session = await restaurant.getSession(tenant.id, opened.session.id);
  assert.equal(session.sale.id, opened.sale.id);
  assert.equal(session.sale.estado, 'BORRADOR');
  assert.equal(session.sale.detalles.length, 2);

  // AC-02: QR confirms its own total and enters immediately without waiter approval.
  const qrContext = await restaurant.getQrContext(table.qrToken);
  assert.equal(qrContext.open, true);
  const qrOrder = await restaurant.placeQrOrder(table.qrToken, {
    externalRequestId: `QR-${stamp}`,
    confirmedTotal: 8000,
    items: [{ menuItemId: dessertMenu.id, quantity: 1 }]
  });
  assert.equal(qrOrder.source, 'QR');
  assert.equal(qrOrder.state, 'ENVIADO');
  assert.equal(qrOrder.commands.length, 1);
  assert.equal(qrOrder.commands[0].station, 'POSTRES');
  assert.equal(qrOrder.commands[0].state, 'PENDIENTE');
  session = await restaurant.getSession(tenant.id, opened.session.id);
  assert.equal(session.sale.id, opened.sale.id);
  assert.equal(session.sale.detalles.length, 3);
  const waiterVisibleOrders = await restaurant.listOrders(tenant.id, { sessionId: opened.session.id }, users.MESERO);
  assert.ok(waiterVisibleOrders.some((x) => x.id === qrOrder.id));

  // AC-05: Core RBAC protects finance/config and station queues are forced server-side.
  assert.equal(await rbac.hasPermission(tenant.id, users.MESERO, 'PEDIDOS.CREAR'), true);
  assert.equal(await rbac.hasPermission(tenant.id, users.MESERO, 'CONFIGURACION.VER'), false);
  assert.equal(await rbac.hasPermission(tenant.id, users.MESERO, 'CONTABILIDAD.VER'), false);
  assert.equal(await rbac.hasPermission(tenant.id, users.MESERO, 'REPORTES.VER'), false);
  assert.equal(await rbac.hasPermission(tenant.id, users.COCINA, 'CONTABILIDAD.VER'), false);
  const kitchenQueue = await restaurant.listCommands(tenant.id, users.COCINA, { station: 'BARRA' });
  assert.ok(kitchenQueue.length >= 1);
  assert.ok(kitchenQueue.every((x) => x.station === 'COCINA'));
  const barQueue = await restaurant.listCommands(tenant.id, users.BARRA, { station: 'COCINA' });
  assert.ok(barQueue.length >= 1);
  assert.ok(barQueue.every((x) => x.station === 'BARRA'));

  const caja = await prisma.cajaBanco.findFirst({ where: { tenantId: tenant.id, tipo: 'CAJA', activo: true } });
  assert.ok(caja);
  const shift = await restaurant.openCashShift(tenant.id, users.CAJERO.id, { cajaBancoId: caja.id, saldoInicial: 100000 });
  assert.equal(shift.estado, 'ABIERTA');

  const beforeIngredients = await prisma.producto.findMany({ where: { id: { in: [bread.id, meat.id, lemon.id, dessertBase.id] } } });
  const beforeById = new Map(beforeIngredients.map((x) => [x.id, n(x.stockActual)]));

  // AC-03: one atomic close emits Core sale/AU/consumption, split, tip liability and simulated fiscal association.
  const closed = await restaurant.closeTable(tenant.id, users.CAJERO, table.id, {
    formaPago: 'EFECTIVO', cajaBancoId: caja.id, tipAmount: 5000, split: { mode: 'EQUAL', parts: 2 }
  });
  assert.equal(closed.sale.estado, 'EMITIDO');
  assert.ok(closed.sale.asiento);
  assert.equal(closed.sale.asiento.tipoComprobante.codigo, 'AU');
  assert.ok(balanced(closed.sale.asiento));
  assert.ok(closed.sale.consumptionRun);
  assert.equal(closed.sale.consumptionRun.state, 'COMPLETED');
  assert.equal(closed.fiscalDocument.mode, 'SIMULATED');
  assert.equal(closed.fiscalDocument.simulatedData.fiscalAcceptance, false);
  assert.equal(closed.split.mode, 'EQUAL');
  assert.equal(closed.split.parts.length, 2);
  assert.ok(closeEnough(closed.split.parts.reduce((sum, x) => sum + n(x.amount), 0), n(closed.sale.total) + 5000));
  assert.ok(closed.tipPosting?.journal && balanced(closed.tipPosting.journal));
  const tipCredit = closed.tipPosting.journal.detalles.find((x) => x.cuenta?.codigo === '238095');
  assert.ok(tipCredit && closeEnough(tipCredit.credito, 5000));

  const afterIngredients = await prisma.producto.findMany({ where: { id: { in: [bread.id, meat.id, lemon.id, dessertBase.id] } } });
  const afterById = new Map(afterIngredients.map((x) => [x.id, n(x.stockActual)]));
  assert.ok(closeEnough(beforeById.get(bread.id) - afterById.get(bread.id), 1));
  assert.ok(closeEnough(beforeById.get(meat.id) - afterById.get(meat.id), 1));
  assert.ok(closeEnough(beforeById.get(lemon.id) - afterById.get(lemon.id), 2));
  assert.ok(closeEnough(beforeById.get(dessertBase.id) - afterById.get(dessertBase.id), 1));
  const tableAfter = await prisma.restaurantTable.findFirst({ where: { id: table.id, tenantId: tenant.id } });
  assert.equal(tableAfter.state, 'LIBRE');

  // AC-04: shift summary equals the closed table sale + separate tip, and exact physical count closes with zero drift.
  const shiftSummary = await restaurant.cashShiftSummary(tenant.id, users.CAJERO.id, shift.id);
  const expectedRestaurant = n(closed.sale.total) + 5000;
  assert.equal(shiftSummary.tables.length, 1);
  assert.ok(closeEnough(shiftSummary.restaurantClosedTablesTotal, expectedRestaurant));
  assert.ok(closeEnough(shiftSummary.restaurantCashRecorded, expectedRestaurant));
  assert.ok(closeEnough(shiftSummary.systemCashExpected, 100000 + expectedRestaurant));
  const closedShift = await restaurant.closeCashShift(tenant.id, users.CAJERO.id, shift.id, { saldoFinal: 100000 + expectedRestaurant });
  assert.equal(closedShift.closed.estado, 'CERRADA');
  assert.ok(closeEnough(closedShift.closed.descuadre, 0));

  // AC-06: simulated validation is visible and cannot claim production with open external gates.
  const status = await restaurant.getStatus(tenant.id);
  assert.equal(status.label, 'Funcional — validado con impresión simulada (PDF/pantalla)');
  assert.equal(status.productionReady, false);
  assert.equal(status.productionLabel, 'PRODUCCIÓN REAL BLOQUEADA');
  assert.equal(status.gates.physicalPrinterFieldPass, false);
  assert.equal(status.gates.metaBusinessManagementReviewPass, false);
  assert.equal(status.gates.dianRealEnabled, false);
  assert.equal(status.gates.simulatedFiscalOperationExplicitlyAccepted, false);

  // A normal functional operation must never silently close a production gate.
  const config = await prisma.restaurantConfig.findUnique({ where: { tenantId: tenant.id } });
  assert.equal(config.physicalPrinterFieldPass, false);
  assert.equal(config.metaBusinessManagementReviewPass, false);
  assert.equal(config.dianRealEnabled, false);

  console.log('RESTAURANT PHASE 2 SIMULATED ACCEPTANCE OK');
  console.log(JSON.stringify({
    AC01_simulatedStationRouting: true,
    AC02_qrImmediateSameDraft: true,
    AC03_atomicCloseSplitTipAuConsumptionFiscal: true,
    AC04_cashShiftReconciliation: true,
    AC05_coreRbacAndStationIsolation: true,
    AC06_visibleSimulatedStatusProductionBlocked: true,
    saleNumber: closed.sale.numero,
    saleTotal: n(closed.sale.total),
    tip: 5000,
    shiftDrift: n(closedShift.closed.descuadre),
    realPhysicalPrinterClaimed: false,
    realMetaReviewClaimed: false,
    realDianClaimed: false
  }, null, 2));
}

main().catch((error) => {
  console.error('RESTAURANT PHASE 2 SIMULATED ACCEPTANCE FAILED');
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
