'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const base = require('../src/modules/restaurant/restaurant.service');
const sales = require('../src/modules/commercial/sales.service');
const treasury = require('../src/modules/treasury/treasury.service');
const consumption = require('../src/modules/consumption/consumption.service');

function n(value) { return Number(value || 0); }

async function createProduct(tenantId, suffix, data) {
  return prisma.producto.create({
    data: {
      tenantId,
      tipo: 'PRODUCTO',
      sku: `${data.sku}-${suffix}`.slice(0, 80),
      nombre: data.nombre,
      descripcion: data.descripcion || null,
      unidadMedida: data.unidadMedida || 'UND',
      controlaInventario: Boolean(data.controlaInventario),
      costoPromedio: data.costoPromedio || 0,
      stockActual: data.stockActual || 0,
      precio1: data.precio1 || 0,
      ivaPct: 0,
      impoconsumoPct: 0,
      activo: true
    }
  });
}

async function emitSale({ demo, admin, cashAccount, product, suffix, label, quantity = 1 }) {
  return sales.create(demo.tenantId, admin.id, {
    estado: 'EMITIDO',
    sourceId: `CARTA-STOCK-${suffix}-${label}`,
    formaPago: 'EFECTIVO',
    cajaBancoId: cashAccount.id,
    documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    notas: `Smoke Carta ${label}`,
    detalles: [{
      productoId: product.id,
      descripcion: product.nombre,
      cantidad: quantity,
      precioUnitario: n(product.precio1),
      descuentoPct: 0,
      ivaPct: 0,
      impoconsumoPct: 0
    }]
  });
}

async function stock(productId) {
  const row = await prisma.producto.findUnique({ where: { id: productId } });
  assert.ok(row, 'producto de prueba debe existir');
  return n(row.stockActual);
}

async function saleMovements(tenantId, saleId, productId) {
  return prisma.movimientoInventario.findMany({
    where: { tenantId, comprobanteId: saleId, productoId: productId },
    orderBy: { creadoEn: 'asc' }
  });
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  assert.ok(admin, 'ADMIN demo requerido');

  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();
  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo: 'CAJA',
    nombre: `Caja Carta DB ${suffix}`,
    banco: null,
    numeroCuenta: null,
    cuentaContableId: null,
    saldoActual: 0,
    activo: true
  });

  await prisma.restaurantConfig.upsert({
    where: { tenantId: demo.tenantId },
    create: { tenantId: demo.tenantId, dianRealEnabled: false, allowSimulatedDocumentEquivalent: true },
    update: { dianRealEnabled: false, allowSimulatedDocumentEquivalent: true }
  });

  // 1) VENTA DIRECTA: la misma Coca-Cola del producto maestro se vende desde Carta.
  const direct = await createProduct(demo.tenantId, suffix, {
    sku: 'CARTA-COCA', nombre: 'Coca-Cola Carta DB', controlaInventario: true,
    stockActual: 50, costoPromedio: 2200, precio1: 5000
  });
  const directMenu = await base.saveMenuItem(demo.tenantId, null, {
    productId: direct.id, category: 'BEBIDAS', station: 'BARRA', requiresRecipe: false, active: true, sortOrder: 9001
  });
  assert.equal(directMenu.productId, direct.id, 'Carta debe usar el mismo producto maestro');
  const directSale = await emitSale({ demo, admin, cashAccount, product: direct, suffix, label: 'DIRECT' });
  assert.equal(await stock(direct.id), 49, '50 Coca-Colas - 1 venta = 49');
  const directMoves = await saleMovements(demo.tenantId, directSale.id, direct.id);
  assert.equal(directMoves.length, 1, 'venta directa debe producir un movimiento de Kardex');
  assert.equal(directMoves[0].tipo, 'VENTA');
  assert.equal(n(directMoves[0].stockAnterior), 50);
  assert.equal(n(directMoves[0].stockNuevo), 49);
  assert.equal(await prisma.consumptionRun.count({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: directSale.id } }), 0, 'venta directa no debe ejecutar receta');

  // 2) PREPARADO / SIN CONTROL: se vende normalmente y no exige receta ni stock terminado.
  const prepared = await createProduct(demo.tenantId, suffix, {
    sku: 'CARTA-HAMB-PREP', nombre: 'Hamburguesa preparada Carta DB', controlaInventario: false,
    stockActual: 0, costoPromedio: 0, precio1: 26000
  });
  await base.saveMenuItem(demo.tenantId, null, {
    productId: prepared.id, category: 'FUERTES', station: 'COCINA', requiresRecipe: false, active: true, sortOrder: 9002
  });
  const preparedSale = await emitSale({ demo, admin, cashAccount, product: prepared, suffix, label: 'PREPARED' });
  assert.equal(await stock(prepared.id), 0, 'plato preparado no inventa stock terminado');
  assert.equal((await saleMovements(demo.tenantId, preparedSale.id, prepared.id)).length, 0, 'plato preparado no genera salida directa de Kardex');
  assert.equal(await prisma.consumptionRun.count({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: preparedSale.id } }), 0, 'plato preparado sin receta debe venderse sin consumo');

  // 3) RECETA: el producto vendido no descuenta stock propio; descuenta únicamente insumos.
  const ingredient = await createProduct(demo.tenantId, suffix, {
    sku: 'CARTA-CARNE', nombre: 'Carne insumo Carta DB', controlaInventario: true,
    stockActual: 10, costoPromedio: 3000, precio1: 0
  });
  const recipeOutput = await createProduct(demo.tenantId, suffix, {
    sku: 'CARTA-HAMB-REC', nombre: 'Hamburguesa receta Carta DB', controlaInventario: false,
    stockActual: 0, costoPromedio: 0, precio1: 30000
  });
  const recipe = await consumption.createRecipe(demo.tenantId, {
    code: `CARTA-REC-${suffix}`.slice(0, 60),
    name: `Receta Carta DB ${suffix}`,
    outputProductId: recipeOutput.id,
    active: true,
    items: [{ ingredientProductId: ingredient.id, quantity: 2, unitLabel: 'UND' }]
  });
  const recipeMenu = await base.saveMenuItem(demo.tenantId, null, {
    productId: recipeOutput.id, category: 'FUERTES', station: 'COCINA', requiresRecipe: true, active: true, sortOrder: 9003
  });
  const recipeSale1 = await emitSale({ demo, admin, cashAccount, product: recipeOutput, suffix, label: 'RECIPE-1' });
  assert.equal(await stock(ingredient.id), 8, 'receta debe consumir 2 unidades del insumo');
  assert.equal(await stock(recipeOutput.id), 0, 'salida de receta no descuenta producto terminado');
  const recipeRun1 = await prisma.consumptionRun.findFirst({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: recipeSale1.id }, include: { items: true } });
  assert.ok(recipeRun1, 'venta con receta debe crear ejecución de consumo');
  assert.equal(recipeRun1.items.length, 1);
  assert.equal((await saleMovements(demo.tenantId, recipeSale1.id, ingredient.id)).length, 1, 'insumo debe dejar movimiento de Kardex');
  assert.equal((await saleMovements(demo.tenantId, recipeSale1.id, recipeOutput.id)).length, 0, 'producto de salida no debe tener movimiento directo');

  // 4) Salir de RECETA conserva la receta pero la vuelve inactiva. PREPARADO no toca ingredientes.
  await consumption.updateRecipe(demo.tenantId, recipe.id, { active: false });
  await prisma.producto.update({ where: { id: recipeOutput.id }, data: { controlaInventario: false } });
  await base.saveMenuItem(demo.tenantId, recipeMenu.id, {
    productId: recipeOutput.id, category: 'FUERTES', station: 'COCINA', requiresRecipe: false, active: true, sortOrder: 9003
  });
  const preparedFromRecipeSale = await emitSale({ demo, admin, cashAccount, product: recipeOutput, suffix, label: 'RECIPE-AS-PREPARED' });
  assert.equal(await stock(ingredient.id), 8, 'receta inactiva no puede seguir consumiendo ingredientes');
  assert.equal(await prisma.consumptionRun.count({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: preparedFromRecipeSale.id } }), 0);

  // 5) El mismo producto puede pasar a INVENTARIO DIRECTO sin borrar la receta histórica.
  await prisma.producto.update({ where: { id: recipeOutput.id }, data: { controlaInventario: true, stockActual: 5, costoPromedio: 4000 } });
  const directFromRecipeSale = await emitSale({ demo, admin, cashAccount, product: { ...recipeOutput, controlaInventario: true, stockActual: 5, costoPromedio: 4000 }, suffix, label: 'RECIPE-AS-DIRECT' });
  assert.equal(await stock(recipeOutput.id), 4, 'producto cambiado a directo debe descontar su stock propio');
  assert.equal(await stock(ingredient.id), 8, 'modo directo no debe consumir receta inactiva');
  assert.equal((await saleMovements(demo.tenantId, directFromRecipeSale.id, recipeOutput.id)).length, 1);
  assert.ok(await prisma.consumptionRecipe.findUnique({ where: { id: recipe.id } }), 'la receta debe seguir guardada');

  // 6) Volver a RECETA reactiva el mismo registro y deja de descontar stock directo.
  await prisma.producto.update({ where: { id: recipeOutput.id }, data: { controlaInventario: false } });
  await consumption.updateRecipe(demo.tenantId, recipe.id, { active: true });
  await base.saveMenuItem(demo.tenantId, recipeMenu.id, {
    productId: recipeOutput.id, category: 'FUERTES', station: 'COCINA', requiresRecipe: true, active: true, sortOrder: 9003
  });
  const recipeSale2 = await emitSale({ demo, admin, cashAccount, product: { ...recipeOutput, controlaInventario: false }, suffix, label: 'RECIPE-2' });
  assert.equal(await stock(ingredient.id), 6, 'receta reactivada vuelve a consumir insumos');
  assert.equal(await stock(recipeOutput.id), 4, 'stock histórico del producto terminado se conserva pero no se descuenta en modo receta');
  assert.equal((await saleMovements(demo.tenantId, recipeSale2.id, recipeOutput.id)).length, 0);
  assert.ok(await prisma.consumptionRun.findFirst({ where: { tenantId: demo.tenantId, sourceType: 'SALE', sourceId: recipeSale2.id } }));

  console.log('RESTAURANT V2 CARTA STOCK DB SMOKE OK', JSON.stringify({
    direct: { initial: 50, sold: 1, final: 49, kardex: true },
    prepared: { sold: true, stockRequired: false, recipeRequired: false },
    recipe: { ingredientInitial: 10, firstFinal: 8, reactivatedFinal: 6 },
    switching: { recipePreserved: true, inactiveRecipeDoesNotConsume: true, directDoesNotConsumeRecipe: true },
    postgresReal: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
