'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const service = require('../src/modules/restaurant/restaurant-menu-import.service');
const cleanup = require('../src/modules/restaurant/restaurant-menu-ocr-cleanup.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:`OCR Menu QA ${stamp}`, subdomain:`ocr-menu-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'OCR QA', email:`ocr-${stamp}@example.test`, password:'not-used', rol:'ADMIN' }
  });

  try {
    const first = await service.confirmImport(tenant.id, user.id, {
      fileName:'carta-prueba.pdf',
      items:[
        { category:'Hamburguesas', subcategory:'Ranchera', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.98 },
        { category:'Bebidas', subcategory:'Limonada natural', price:9000, operationalCategory:'BEBIDAS', station:'BARRA', confidence:.95 }
      ]
    });
    assert.equal(first.created, 2);
    assert.equal(first.updated, 0);
    assert.equal(first.total, 2);

    const products = await prisma.producto.findMany({ where:{ tenantId:tenant.id }, orderBy:{ nombre:'asc' } });
    assert.equal(products.length, 2);
    const ranchera = products.find((row) => row.nombre === 'Ranchera');
    assert.ok(ranchera);
    assert.match(ranchera.sku, /^MENU-OCR-/);
    assert.equal(ranchera.descripcion, 'Categoría de carta: Hamburguesas');
    assert.equal(Number(ranchera.precio1), 25000);
    assert.equal(ranchera.controlaInventario, false);

    const menu = await prisma.restaurantMenuItem.findMany({ where:{ tenantId:tenant.id } });
    assert.equal(menu.length, 2);
    const rancheraMenu = menu.find((row) => row.productId === ranchera.id);
    assert.ok(rancheraMenu);
    assert.equal(rancheraMenu.category, 'FUERTES');
    assert.equal(rancheraMenu.station, 'COCINA');
    assert.equal(rancheraMenu.requiresRecipe, false);

    const second = await service.confirmImport(tenant.id, user.id, {
      fileName:'carta-prueba-actualizada.jpg',
      items:[
        { category:'Hamburguesas', subcategory:'Ranchera', price:27000, operationalCategory:'FUERTES', station:'COCINA', confidence:.99 },
        { category:'Bebidas', subcategory:'Limonada natural', price:9500, operationalCategory:'BEBIDAS', station:'BARRA', confidence:.97 }
      ]
    });
    assert.equal(second.created, 0, 'same category/name must not duplicate products');
    assert.equal(second.updated, 2);
    assert.equal(await prisma.producto.count({ where:{ tenantId:tenant.id } }), 2);
    assert.equal(await prisma.restaurantMenuItem.count({ where:{ tenantId:tenant.id } }), 2);

    const updatedRanchera = await prisma.producto.findUnique({ where:{ id:ranchera.id } });
    assert.equal(Number(updatedRanchera.precio1), 27000);

    const carta = await service.listCarta(tenant.id);
    const publicRanchera = carta.find((row) => row.subcategory === 'Ranchera');
    assert.ok(publicRanchera);
    assert.equal(publicRanchera.category, 'Hamburguesas');
    assert.equal(publicRanchera.price, 27000);
    assert.equal(publicRanchera.importedByOcr, true);

    const manualProduct = await prisma.producto.create({
      data: {
        tenantId:tenant.id,
        sku:`MANUAL-${stamp}`,
        nombre:'Producto manual',
        descripcion:'Debe sobrevivir limpieza OCR',
        unidadMedida:'UND',
        controlaInventario:false,
        precio1:15000,
        activo:true
      }
    });
    await prisma.restaurantMenuItem.create({
      data: { tenantId:tenant.id, productId:manualProduct.id, category:'FUERTES', station:'COCINA', requiresRecipe:false, active:true }
    });

    const cleared = await cleanup.clearImportedOcr(tenant.id);
    assert.equal(cleared.found, 2);
    assert.equal(cleared.productsDeactivated, 2);
    assert.equal(cleared.menuItemsHidden, 2);

    const hiddenProducts = await prisma.producto.findMany({ where:{ tenantId:tenant.id, sku:{ startsWith:'MENU-OCR-' } } });
    assert.equal(hiddenProducts.length, 2);
    assert.ok(hiddenProducts.every((row) => row.activo === false));
    const hiddenMenu = await prisma.restaurantMenuItem.findMany({ where:{ tenantId:tenant.id, productId:{ in:hiddenProducts.map((row) => row.id) } } });
    assert.ok(hiddenMenu.every((row) => row.active === false));

    const manualAfter = await prisma.producto.findUnique({ where:{ id:manualProduct.id } });
    const manualMenuAfter = await prisma.restaurantMenuItem.findUnique({ where:{ tenantId_productId:{ tenantId:tenant.id, productId:manualProduct.id } } });
    assert.equal(manualAfter.activo, true, 'manual product must not be deactivated');
    assert.equal(manualMenuAfter.active, true, 'manual menu item must not be hidden');

    const visibleAfterCleanup = await service.listCarta(tenant.id);
    assert.equal(visibleAfterCleanup.some((row) => row.importedByOcr), false, 'OCR items must disappear from visible menu');

    const audits = await prisma.auditoriaContable.findMany({ where:{ tenantId:tenant.id, entidad:'RESTAURANT_MENU_OCR_IMPORT' } });
    assert.equal(audits.length, 2, 'each confirmed import must leave an audit record');

    console.log('RESTAURANT MENU OCR DB SMOKE OK');
  } finally {
    await prisma.auditoriaContable.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.restaurantMenuItem.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.producto.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.user.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.tenant.delete({ where:{ id:tenant.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
