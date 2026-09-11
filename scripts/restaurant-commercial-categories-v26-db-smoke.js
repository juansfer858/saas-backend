'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const menuImport = require('../src/modules/restaurant/restaurant-menu-import.service');
const editService = require('../src/modules/restaurant/restaurant-menu-item-edit.service');
const categories = require('../src/modules/restaurant/restaurant-commercial-categories-v26.service');
const menuSurface = require('../src/modules/restaurant/restaurant-menu-surface-sync.service');
const restaurantService = require('../src/modules/restaurant/restaurant.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:`Category V26 QA ${stamp}`, subdomain:`category-v26-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'Category V26 QA', email:`category-v26-${stamp}@example.test`, password:'not-used', rol:'ADMIN' }
  });

  try {
    await menuImport.confirmImport(tenant.id, user.id, {
      fileName:'carta-v26.pdf',
      items:[
        { category:'Hamburguesas', subcategory:'Ranchera', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.99 },
        { category:'Jugos naturales', subcategory:'Mango', price:8000, operationalCategory:'BEBIDAS', station:'BARRA', confidence:.99 }
      ]
    });

    const legacyCarta = await menuImport.listCarta(tenant.id);
    const carta = await categories.decorateCartaRows(tenant.id, legacyCarta);
    const ranchera = carta.find((row) => row.subcategory === 'Ranchera');
    const mango = carta.find((row) => row.subcategory === 'Mango');
    assert.ok(ranchera?.categoryId, 'legacy/imported menu item must receive central category id');
    assert.ok(mango?.categoryId, 'every imported menu item must receive central category id');
    assert.equal(ranchera.category, 'Hamburguesas');
    assert.equal(mango.category, 'Jugos naturales');

    const initialCategories = await categories.listCategories(tenant.id, { includeInactive:true });
    assert.ok(initialCategories.some((row) => row.name === 'Hamburguesas'));
    assert.ok(initialCategories.some((row) => row.name === 'Jugos naturales'));

    const pizzas = await categories.createCategory(tenant.id, { name:'Pizzas' });
    await categories.assignMenuItem(tenant.id, ranchera.id, pizzas.id);
    const assigned = await prisma.restaurantMenuItem.findUnique({ where:{ id:ranchera.id } });
    assert.equal(assigned.commercialCategoryId, pizzas.id);
    assert.equal(assigned.category, 'FUERTES', 'commercial assignment must not alter operational category');
    assert.equal(assigned.station, 'COCINA', 'commercial assignment must not alter station');

    const renamed = await categories.updateCategory(tenant.id, pizzas.id, { name:'Especiales', sortOrder:0 });
    assert.equal(renamed.name, 'Especiales');
    const productAfterRename = await prisma.producto.findUnique({ where:{ id:ranchera.productId } });
    assert.equal(productAfterRename.descripcion, 'Categoría de carta: Especiales', 'legacy label must follow central rename');

    await assert.rejects(
      categories.updateCategory(tenant.id, pizzas.id, { active:false }),
      (error) => error?.code === 'RESTAURANT_COMMERCIAL_CATEGORY_IN_USE'
    );

    const edited = await editService.updateImportedCartaItem(tenant.id, user.id, ranchera.id, {
      category:'Especiales',
      subcategory:'Ranchera doble',
      price:29900,
      operationalCategory:'ENTRADAS',
      station:'COCINA'
    });
    await categories.assignMenuItemByName(tenant.id, edited.id, edited.category);
    assert.equal(edited.id, ranchera.id, 'imported menu item identity must survive editing');
    assert.equal(edited.productId, ranchera.productId, 'imported product identity must survive editing');

    const updatedProduct = await prisma.producto.findUnique({ where:{ id:ranchera.productId } });
    const updatedMenu = await prisma.restaurantMenuItem.findUnique({ where:{ id:ranchera.id } });
    assert.equal(updatedProduct.nombre, 'Ranchera doble');
    assert.equal(Number(updatedProduct.precio1), 29900);
    assert.equal(updatedMenu.category, 'ENTRADAS');
    assert.equal(updatedMenu.station, 'COCINA');
    assert.equal(updatedMenu.commercialCategoryId, pizzas.id);

    menuSurface.install();
    const meseroMenu = await restaurantService.listMenu(tenant.id, { active:true });
    const meseroRanchera = meseroMenu.find((row) => row.id === ranchera.id);
    const meseroMango = meseroMenu.find((row) => row.id === mango.id);
    assert.equal(meseroRanchera.displayCategory, 'Especiales', 'Mesero must receive central category name');
    assert.equal(meseroRanchera.category, 'ENTRADAS', 'Mesero must retain operational category separately');
    assert.equal(meseroMango.displayCategory, 'Jugos naturales');

    const finalCarta = await categories.decorateCartaRows(tenant.id, await menuImport.listCarta(tenant.id));
    const finalRanchera = finalCarta.find((row) => row.id === ranchera.id);
    assert.equal(finalRanchera.category, 'Especiales');
    assert.equal(finalRanchera.categoryId, pizzas.id);
    assert.equal(finalRanchera.subcategory, 'Ranchera doble');
    assert.equal(finalRanchera.price, 29900);

    console.log('RESTAURANT COMMERCIAL CATEGORIES V26 DB OK');
  } finally {
    await prisma.auditoriaContable.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.restaurantMenuItem.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
    await prisma.restaurantCommercialCategory.deleteMany({ where:{ tenantId:tenant.id } }).catch(() => {});
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
