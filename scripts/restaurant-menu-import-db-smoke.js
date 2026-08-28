'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const service = require('../src/modules/restaurant/restaurant-menu-import.service');

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
