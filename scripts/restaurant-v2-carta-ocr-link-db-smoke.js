'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const linkImport = require('../src/modules/restaurant/restaurant-menu-import-link.service');
const consumption = require('../src/modules/consumption/consumption.service');
const sales = require('../src/modules/commercial/sales.service');
const treasury = require('../src/modules/treasury/treasury.service');

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

async function expectCode(promise, code) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `se esperaba error ${code}`);
  assert.equal(error.code, code);
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  assert.ok(admin);
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase();

  const caja = await treasury.createCajaBanco(demo.tenantId, {
    tipo: 'CAJA', nombre: `Caja OCR Link ${suffix}`, banco: null, numeroCuenta: null,
    cuentaContableId: null, saldoActual: 0, activo: true
  });
  await prisma.restaurantConfig.upsert({
    where: { tenantId: demo.tenantId },
    create: { tenantId: demo.tenantId, dianRealEnabled: false, allowSimulatedDocumentEquivalent: true },
    update: { dianRealEnabled: false, allowSimulatedDocumentEquivalent: true }
  });

  const coke = await createProduct(demo.tenantId, suffix, {
    sku: 'OCR-LINK-COCA', nombre: 'Coca-Cola 400 ml maestro', descripcion: 'Bebida comprada',
    controlaInventario: true, stockActual: 50, costoPromedio: 2200, precio1: 4500
  });
  const originalSku = coke.sku;
  const originalName = coke.nombre;
  const originalCost = n(coke.costoPromedio);

  const category = `Gaseosas ${suffix}`;
  const preparedName = `Hamburguesa OCR ${suffix}`;
  const result = await linkImport.confirmImportLinked(demo.tenantId, admin.id, {
    fileName: `carta-${suffix}.pdf`,
    items: [
      {
        category,
        subcategory: 'Coca Cola 400',
        price: 6000,
        operationalCategory: 'BEBIDAS',
        station: 'BARRA',
        confidence: 0.99,
        existingProductId: coke.id
      },
      {
        category: `Hamburguesas ${suffix}`,
        subcategory: preparedName,
        price: 28000,
        operationalCategory: 'FUERTES',
        station: 'COCINA',
        confidence: 0.96,
        existingProductId: null
      }
    ]
  });

  assert.equal(result.total, 2);
  assert.equal(result.linked, 1);
  assert.equal(result.created, 1);
  const linkedRow = result.items.find((row) => row.source === 'INVENTORY_DIRECT');
  const preparedRow = result.items.find((row) => row.source === 'PREPARED');
  assert.ok(linkedRow && preparedRow);
  assert.equal(linkedRow.productId, coke.id, 'OCR debe reutilizar el mismo producto maestro');

  const cokeAfterImport = await prisma.producto.findUnique({ where: { id: coke.id } });
  assert.equal(cokeAfterImport.sku, originalSku, 'vincular no cambia SKU');
  assert.equal(cokeAfterImport.nombre, originalName, 'vincular no pisa nombre maestro');
  assert.equal(n(cokeAfterImport.stockActual), 50, 'importar no mueve stock');
  assert.equal(n(cokeAfterImport.costoPromedio), originalCost, 'importar no cambia costo');
  assert.equal(n(cokeAfterImport.precio1), 6000, 'precio de Carta sí se actualiza');
  assert.equal(cokeAfterImport.controlaInventario, true);

  const linkedMenu = await prisma.restaurantMenuItem.findUnique({
    where: { tenantId_productId: { tenantId: demo.tenantId, productId: coke.id } }
  });
  assert.ok(linkedMenu);
  assert.equal(linkedMenu.category, 'BEBIDAS');
  assert.equal(linkedMenu.station, 'BARRA');
  assert.equal(linkedMenu.requiresRecipe, false);

  const prepared = await prisma.producto.findUnique({ where: { id: preparedRow.productId } });
  assert.ok(prepared);
  assert.equal(prepared.nombre, preparedName);
  assert.equal(prepared.controlaInventario, false, 'fila no vinculada queda preparada');
  assert.equal(n(prepared.stockActual), 0);

  const sale = await sales.create(demo.tenantId, admin.id, {
    estado: 'EMITIDO',
    sourceId: `OCR-LINK-SALE-${suffix}`,
    formaPago: 'EFECTIVO',
    cajaBancoId: caja.id,
    documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    notas: 'Venta producto vinculado desde OCR',
    detalles: [{
      productoId: coke.id,
      descripcion: cokeAfterImport.nombre,
      cantidad: 1,
      precioUnitario: 6000,
      descuentoPct: 0,
      ivaPct: 0,
      impoconsumoPct: 0
    }]
  });
  const cokeAfterSale = await prisma.producto.findUnique({ where: { id: coke.id } });
  assert.equal(n(cokeAfterSale.stockActual), 49, 'el stock sólo baja al vender: 50 -> 49');
  const movement = await prisma.movimientoInventario.findFirst({
    where: { tenantId: demo.tenantId, comprobanteId: sale.id, productoId: coke.id, tipo: 'VENTA' }
  });
  assert.ok(movement, 'venta vinculada debe dejar Kardex');
  assert.equal(n(movement.stockAnterior), 50);
  assert.equal(n(movement.stockNuevo), 49);

  await expectCode(
    linkImport.confirmImportLinked(demo.tenantId, admin.id, {
      fileName: 'duplicado.pdf',
      items: [
        { category:'Bebidas', subcategory:'Coca A', price:6100, operationalCategory:'BEBIDAS', station:'BARRA', existingProductId:coke.id },
        { category:'Bebidas', subcategory:'Coca B', price:6200, operationalCategory:'BEBIDAS', station:'BARRA', existingProductId:coke.id }
      ]
    }),
    'RESTAURANT_MENU_IMPORT_DUPLICATE_INVENTORY_LINK'
  );

  const ingredient = await createProduct(demo.tenantId, suffix, {
    sku:'OCR-LINK-INSUMO', nombre:'Insumo receta OCR', controlaInventario:true,
    stockActual:10, costoPromedio:1000, precio1:0
  });
  const recipeOutput = await createProduct(demo.tenantId, suffix, {
    sku:'OCR-LINK-RECETA', nombre:'Producto con receta activa OCR', controlaInventario:true,
    stockActual:5, costoPromedio:2000, precio1:15000
  });
  await consumption.createRecipe(demo.tenantId, {
    code:`OCR-LINK-REC-${suffix}`.slice(0, 60),
    name:`Receta OCR Link ${suffix}`,
    outputProductId:recipeOutput.id,
    active:true,
    items:[{ ingredientProductId:ingredient.id, quantity:1, unitLabel:'UND' }]
  });
  await expectCode(
    linkImport.confirmImportLinked(demo.tenantId, admin.id, {
      fileName:'receta-activa.pdf',
      items:[{
        category:'Fuertes', subcategory:'Producto receta', price:16000,
        operationalCategory:'FUERTES', station:'COCINA', existingProductId:recipeOutput.id
      }]
    }),
    'RESTAURANT_MENU_IMPORT_INVENTORY_PRODUCT_HAS_ACTIVE_RECIPE'
  );

  console.log('RESTAURANT V2 CARTA OCR LINK DB SMOKE OK', JSON.stringify({
    manualLink: true,
    importStockUnchanged: 50,
    saleStock: 49,
    skuPreserved: true,
    costPreserved: true,
    preparedDefault: true,
    duplicateLinkBlocked: true,
    activeRecipeDirectLinkBlocked: true,
    postgresReal: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
