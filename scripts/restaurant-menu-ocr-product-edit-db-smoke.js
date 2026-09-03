'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const menuImport = require('../src/modules/restaurant/restaurant-menu-import.service');
const editService = require('../src/modules/restaurant/restaurant-menu-item-edit.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa:`OCR Edit QA ${stamp}`, subdomain:`ocr-edit-${stamp}`, nicho:'RESTAURANTE_QA', pais:'CO', moneda:'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'OCR Edit QA', email:`ocr-edit-${stamp}@example.test`, password:'not-used', rol:'ADMIN' }
  });

  try {
    await menuImport.confirmImport(tenant.id, user.id, {
      fileName:'carta-edit.pdf',
      items:[
        { category:'Hamburguesas', subcategory:'Ranchera', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.98 }
      ]
    });

    const beforeList = await menuImport.listCarta(tenant.id);
    const before = beforeList.find((row) => row.subcategory === 'Ranchera');
    assert.ok(before);
    assert.equal(before.importedByOcr, true);

    const originalProduct = await prisma.producto.findUnique({ where:{ id:before.productId } });
    const originalMenu = await prisma.restaurantMenuItem.findUnique({ where:{ id:before.id } });
    assert.ok(originalProduct);
    assert.ok(originalMenu);
    const originalSku = originalProduct.sku;

    const edited = await editService.updateImportedCartaItem(tenant.id, user.id, before.id, {
      category:'Hamburguesas premium',
      subcategory:'Ranchera especial',
      price:28900,
      operationalCategory:'ENTRADAS',
      station:'COCINA'
    });

    assert.equal(edited.id, before.id, 'menu item identity must remain stable');
    assert.equal(edited.productId, before.productId, 'product identity must remain stable');
    assert.equal(edited.category, 'Hamburguesas premium');
    assert.equal(edited.subcategory, 'Ranchera especial');
    assert.equal(edited.price, 28900);
    assert.equal(edited.operationalCategory, 'ENTRADAS');
    assert.equal(edited.station, 'COCINA');

    const updatedProduct = await prisma.producto.findUnique({ where:{ id:before.productId } });
    const updatedMenu = await prisma.restaurantMenuItem.findUnique({ where:{ id:before.id } });
    assert.equal(updatedProduct.sku, originalSku, 'technical OCR SKU must never change during edit');
    assert.equal(updatedProduct.nombre, 'Ranchera especial');
    assert.equal(updatedProduct.descripcion, 'Categoría de carta: Hamburguesas premium');
    assert.equal(Number(updatedProduct.precio1), 28900);
    assert.equal(updatedMenu.category, 'ENTRADAS');
    assert.equal(updatedMenu.station, 'COCINA');
    assert.equal(updatedMenu.requiresRecipe, originalMenu.requiresRecipe, 'edit must preserve recipe policy');
    assert.equal(updatedMenu.active, originalMenu.active, 'edit must preserve visibility');

    const afterList = await menuImport.listCarta(tenant.id);
    const after = afterList.find((row) => row.id === before.id);
    assert.ok(after);
    assert.equal(after.category, 'Hamburguesas premium');
    assert.equal(after.subcategory, 'Ranchera especial');
    assert.equal(after.price, 28900);

    const audit = await prisma.auditoriaContable.findFirst({
      where:{ tenantId:tenant.id, entidad:'RESTAURANT_MENU_OCR_ITEM', entidadId:before.id, accion:'UPDATE' },
      orderBy:{ creadoEn:'desc' }
    });
    assert.ok(audit, 'persisted OCR edit must be audited');

    const manualProduct = await prisma.producto.create({
      data: {
        tenantId:tenant.id,
        tipo:'PRODUCTO',
        sku:`MANUAL-EDIT-${stamp}`,
        nombre:'Manual',
        descripcion:'Manual',
        unidadMedida:'UND',
        controlaInventario:false,
        costoPromedio:0,
        stockActual:0,
        precio1:15000,
        ivaPct:0,
        impoconsumoPct:0,
        activo:true
      }
    });
    const manualMenu = await prisma.restaurantMenuItem.create({
      data:{ tenantId:tenant.id, productId:manualProduct.id, category:'FUERTES', station:'COCINA', requiresRecipe:false, active:true }
    });

    await assert.rejects(
      editService.updateImportedCartaItem(tenant.id, user.id, manualMenu.id, {
        category:'No debe cambiar', subcategory:'No debe cambiar', price:1, operationalCategory:'FUERTES', station:'COCINA'
      }),
      (error) => error?.code === 'RESTAURANT_MENU_OCR_EDIT_ONLY_IMPORTED'
    );
    const manualAfter = await prisma.producto.findUnique({ where:{ id:manualProduct.id } });
    assert.equal(manualAfter.nombre, 'Manual');
    assert.equal(Number(manualAfter.precio1), 15000);

    console.log('RESTAURANT MENU OCR PRODUCT EDIT DB OK');
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
