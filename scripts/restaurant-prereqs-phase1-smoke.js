const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const consumption = require('../src/modules/consumption/consumption.service');
const sales = require('../src/modules/commercial/sales.service');
const dian = require('../src/modules/platform/dian/dian.service');

function n(v) { return Number(v || 0); }
function balanced(j) { return Math.abs(n(j.totalDebito) - n(j.totalCredito)) < 0.005; }

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Restaurant Prereq ${stamp}`, subdomain: `rest-pre-${stamp}`, nicho: 'RESTAURANTE_QA', pais: 'CO', moneda: 'COP' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Restaurante QA', email: `rest-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });
  await prisma.$transaction(async (tx) => { await seedTenantDefaults(tx, tenant); await seedPlatformDefaults(tx, tenant, user); });

  await dian.saveConfig(tenant.id, user.id, {
    providerCode: 'MOCK_PT', providerName: 'PT habilitación QA', environment: 'HABILITACION', invoiceEnabled: true, payrollEnabled: false, contingencyEnabled: true
  });
  await dian.saveNumberingRange(tenant.id, { documentType: 'DOCUMENTO_EQUIVALENTE_POS', prefix: 'POSR', rangeFrom: 1, rangeTo: 999, nextNumber: 1, authorizationNumber: `QA-${stamp}`, active: true });

  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `CLI-${stamp}`, nombre: 'Cliente Restaurante QA' } });
  const ingredientA = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `ING-A-${stamp}`, nombre: 'Pan QA', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 0, stockActual: 0, precio1: 0, ivaPct: 0, activo: true } });
  const ingredientB = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `ING-B-${stamp}`, nombre: 'Carne QA', unidadMedida: 'KG', controlaInventario: true, costoPromedio: 0, stockActual: 0, precio1: 0, ivaPct: 0, activo: true } });
  const ingredientC = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `ING-C-${stamp}`, nombre: 'Salsa QA', unidadMedida: 'ML', controlaInventario: true, costoPromedio: 0, stockActual: 0, precio1: 0, ivaPct: 0, activo: true } });
  const dish = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'SERVICIO', sku: `PLATO-${stamp}`, nombre: 'Hamburguesa QA', unidadMedida: 'PORCION', controlaInventario: false, costoPromedio: 0, stockActual: 0, precio1: 10000, ivaPct: 0, activo: true } });

  await prisma.$transaction(async (tx) => {
    await inventory.applyMovement(tx, { tenantId: tenant.id, productoId: ingredientA.id, tipo: 'COMPRA', cantidad: 10, costoUnitario: 1000, referencia: 'SEED-A' });
    await inventory.applyMovement(tx, { tenantId: tenant.id, productoId: ingredientB.id, tipo: 'COMPRA', cantidad: 20, costoUnitario: 2000, referencia: 'SEED-B' });
    await inventory.applyMovement(tx, { tenantId: tenant.id, productoId: ingredientC.id, tipo: 'COMPRA', cantidad: 30, costoUnitario: 500, referencia: 'SEED-C' });
  });

  const recipe = await consumption.createRecipe(tenant.id, {
    code: `REC-${stamp}`,
    name: 'Hamburguesa clásica QA',
    outputProductId: dish.id,
    items: [
      { ingredientProductId: ingredientA.id, quantity: 1, unitLabel: 'UND' },
      { ingredientProductId: ingredientB.id, quantity: 0.5, unitLabel: 'KG' },
      { ingredientProductId: ingredientC.id, quantity: 2, unitLabel: 'ML' }
    ]
  });
  assert.equal(recipe.items.length, 3);

  // Fase 1.1 atomic rollback: an impossible recipe consumption must not alter any ingredient.
  let insufficient = null;
  try {
    await consumption.consumeRecipe(tenant.id, user.id, recipe.id, { quantity: 1000, sourceId: `IMPOSSIBLE-${stamp}`, reference: 'Rollback QA' });
  } catch (error) { insufficient = error; }
  assert.equal(insufficient?.code, 'INVENTORY_INSUFFICIENT_STOCK');
  const beforeSale = await prisma.producto.findMany({ where: { id: { in: [ingredientA.id, ingredientB.id, ingredientC.id] } }, orderBy: { sku: 'asc' } });
  assert.deepEqual(beforeSale.map((p) => n(p.stockActual)), [10, 20, 30]);
  assert.equal(await prisma.consumptionRun.count({ where: { tenantId: tenant.id, sourceId: `IMPOSSIBLE-${stamp}` } }), 0);

  // Fase 1.4: draft has no operational/accounting/DIAN effect.
  const draft = await sales.create(tenant.id, user.id, {
    estado: 'BORRADOR', terceroId: customer.id, formaPago: 'CREDITO', documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    sourceId: `REST-SALE-${stamp}`, detalles: [{ productoId: dish.id, cantidad: 2, precioUnitario: 10000, ivaPct: 0 }]
  });
  assert.equal(draft.estado, 'BORRADOR');
  assert.equal(await prisma.movimientoInventario.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  assert.equal(await prisma.asientoContable.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  assert.equal(await prisma.cartera.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  assert.equal(await prisma.dianDocument.count({ where: { tenantId: tenant.id, originId: draft.id } }), 0);

  const emitted = await sales.emit(tenant.id, user.id, draft.id);
  assert.equal(emitted.estado, 'EMITIDO');
  assert.ok(emitted.asiento && balanced(emitted.asiento));
  assert.equal(emitted.asiento.tipoComprobante.codigo, 'AU');
  assert.ok(emitted.consumptionRun);
  assert.equal(n(emitted.consumptionRun.totalCost), 6000);
  assert.equal(emitted.consumptionRun.items.length, 3);
  assert.ok(emitted.dianDocument);
  assert.equal(emitted.dianDocument.state, 'PENDIENTE_ENVIO');
  assert.equal(emitted.dianDocument.documentType, 'DOCUMENTO_EQUIVALENTE_POS');
  assert.match(emitted.dianDocument.fiscalNumber, /^POSR/);

  const afterIssue = await prisma.producto.findMany({ where: { id: { in: [ingredientA.id, ingredientB.id, ingredientC.id] } }, orderBy: { sku: 'asc' } });
  assert.deepEqual(afterIssue.map((p) => n(p.stockActual)), [8, 19, 26]);
  const cxc = await prisma.cartera.findFirst({ where: { tenantId: tenant.id, comprobanteId: draft.id, tipo: 'CXC' } });
  assert.equal(n(cxc.saldo), 20000);
  const cogsDetail = emitted.asiento.detalles.find((line) => line.cuenta?.codigo === '613505' && n(line.debito) > 0);
  assert.equal(n(cogsDetail?.debito), 6000);
  assert.equal(n(emitted.asiento.totalDebito), 26000);
  assert.equal(n(emitted.asiento.totalCredito), 26000);

  // Cancel before fiscal transmission: all core effects reverse.
  await sales.cancel(tenant.id, user.id, draft.id, 'Prueba reversión Fase 1');
  const cancelled = await prisma.comprobanteComercial.findUnique({ where: { id: draft.id }, include: { asiento: true, cartera: true } });
  assert.equal(cancelled.estado, 'ANULADO');
  assert.equal(cancelled.asiento.estado, 'ANULADO');
  assert.equal(n(cancelled.cartera[0].saldo), 0);
  const afterCancel = await prisma.producto.findMany({ where: { id: { in: [ingredientA.id, ingredientB.id, ingredientC.id] } }, orderBy: { sku: 'asc' } });
  assert.deepEqual(afterCancel.map((p) => n(p.stockActual)), [10, 20, 30]);
  const runAfterCancel = await prisma.consumptionRun.findFirst({ where: { tenantId: tenant.id, sourceType: 'SALE', sourceId: draft.id } });
  assert.equal(runAfterCancel.state, 'REVERSED');

  console.log('RESTAURANT PREREQUISITES PHASE 1 CORE SMOKE OK');
  console.log(JSON.stringify({
    consumptionThreeIngredients: true,
    weightedAverageCost: 6000,
    insufficientStockRollback: true,
    salesDraftNoEffects: true,
    salesAtomicIssue: true,
    saleAU: emitted.asiento.numeroComprobante,
    cxc: 20000,
    dianOutboxPOS: emitted.dianDocument.fiscalNumber,
    cancellationRestoredInventory: true,
    realDianAcceptance: false,
    physicalLanPrinter: false
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
