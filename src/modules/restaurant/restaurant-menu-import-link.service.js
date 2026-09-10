'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const base = require('./restaurant-menu-import.service');

const CATEGORY_DESCRIPTION_PREFIX = 'Categoría de carta: ';

function cleanId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function categoryDescription(category) {
  return `${CATEGORY_DESCRIPTION_PREFIX}${String(category || '').trim().slice(0, 80)}`;
}

function safeCategoryDescription(product, category) {
  const current = String(product?.descripcion || '').trim();
  if (!current || current.toLowerCase().startsWith(CATEGORY_DESCRIPTION_PREFIX.toLowerCase())) {
    return categoryDescription(category);
  }
  return current;
}

function normalizeConfirmItems(rawItems) {
  const rows = [];
  const seen = new Set();
  const linkedIds = new Set();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const item = base.normalizeItems([raw])[0];
    if (!item) continue;
    const existingProductId = cleanId(raw?.existingProductId);
    const contentKey = `${base.menuSku(item.category, item.subcategory)}|${item.price}`;
    if (seen.has(contentKey)) continue;
    seen.add(contentKey);
    if (existingProductId) {
      if (linkedIds.has(existingProductId)) {
        throw new AppError(
          400,
          'Un producto del inventario sólo puede vincularse una vez dentro de la misma importación.',
          'RESTAURANT_MENU_IMPORT_DUPLICATE_INVENTORY_LINK'
        );
      }
      linkedIds.add(existingProductId);
    }
    rows.push({ ...item, existingProductId });
    if (rows.length >= 300) break;
  }
  return rows;
}

async function activeRecipe(tx, tenantId, productId) {
  return tx.consumptionRecipe.findFirst({
    where: { tenantId, outputProductId: productId, active: true },
    select: { id: true, name: true }
  });
}

async function resolveLinkedInventoryProduct(tx, tenantId, item) {
  const product = await tx.producto.findFirst({
    where: {
      id: item.existingProductId,
      tenantId,
      activo: true,
      tipo: 'PRODUCTO',
      controlaInventario: true
    }
  });
  if (!product) {
    throw new AppError(
      400,
      'El producto elegido ya no está disponible como inventario directo. Actualiza la Carta e inténtalo de nuevo.',
      'RESTAURANT_MENU_IMPORT_INVENTORY_PRODUCT_INVALID'
    );
  }
  const recipe = await activeRecipe(tx, tenantId, product.id);
  if (recipe) {
    throw new AppError(
      409,
      `El producto ${product.nombre} tiene una receta activa. Configura su modo desde Carta antes de vincularlo como inventario directo.`,
      'RESTAURANT_MENU_IMPORT_INVENTORY_PRODUCT_HAS_ACTIVE_RECIPE'
    );
  }
  return tx.producto.update({
    where: { id: product.id },
    data: {
      precio1: item.price,
      descripcion: safeCategoryDescription(product, item.category),
      activo: true
    }
  });
}

async function resolvePreparedProduct(tx, tenantId, item) {
  const sku = base.menuSku(item.category, item.subcategory);
  let product = await tx.producto.findUnique({ where: { tenantId_sku: { tenantId, sku } } });
  let created = false;
  if (product) {
    product = await tx.producto.update({
      where: { id: product.id },
      data: {
        nombre: item.subcategory,
        descripcion: categoryDescription(item.category),
        precio1: item.price,
        activo: true
      }
    });
  } else {
    product = await tx.producto.create({
      data: {
        tenantId,
        tipo: 'PRODUCTO',
        sku,
        nombre: item.subcategory,
        descripcion: categoryDescription(item.category),
        unidadMedida: 'UND',
        controlaInventario: false,
        costoPromedio: 0,
        stockActual: 0,
        precio1: item.price,
        ivaPct: 0,
        impoconsumoPct: 0,
        activo: true
      }
    });
    created = true;
  }
  const recipe = await activeRecipe(tx, tenantId, product.id);
  return { product, created, requiresRecipe: Boolean(recipe) };
}

async function upsertMenu(tx, tenantId, product, item, index, requiresRecipe) {
  const existing = await tx.restaurantMenuItem.findUnique({
    where: { tenantId_productId: { tenantId, productId: product.id } }
  });
  const data = {
    category: item.operationalCategory,
    station: item.station,
    requiresRecipe: Boolean(requiresRecipe),
    active: true,
    sortOrder: index
  };
  if (existing) return tx.restaurantMenuItem.update({ where: { id: existing.id }, data });
  return tx.restaurantMenuItem.create({ data: { tenantId, productId: product.id, ...data } });
}

async function confirmImportLinked(tenantId, userId, input) {
  const rawItems = Array.isArray(input?.items) ? input.items : [];
  if (!rawItems.some((item) => cleanId(item?.existingProductId))) {
    return base.confirmImport(tenantId, userId, input);
  }

  const items = normalizeConfirmItems(rawItems);
  if (!items.length) throw new AppError(400, 'No hay productos válidos para importar', 'RESTAURANT_MENU_IMPORT_EMPTY');
  const fileName = String(input?.fileName || 'carta').trim().slice(0, 120);

  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    let linked = 0;
    const imported = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let product;
      let requiresRecipe = false;
      let source = 'PREPARED';

      if (item.existingProductId) {
        product = await resolveLinkedInventoryProduct(tx, tenantId, item);
        linked += 1;
        source = 'INVENTORY_DIRECT';
      } else {
        const resolved = await resolvePreparedProduct(tx, tenantId, item);
        product = resolved.product;
        requiresRecipe = resolved.requiresRecipe;
        if (resolved.created) created += 1;
        else updated += 1;
      }

      const menuItem = await upsertMenu(tx, tenantId, product, item, index, requiresRecipe);
      imported.push({
        menuItemId: menuItem.id,
        productId: product.id,
        sku: product.sku,
        category: item.category,
        subcategory: product.nombre,
        price: item.price,
        source
      });
    }

    if (userId) {
      await tx.auditoriaContable.create({
        data: {
          tenantId,
          userId,
          entidad: 'RESTAURANT_MENU_OCR_IMPORT',
          entidadId: tenantId,
          accion: 'IMPORT',
          metadata: {
            fileName,
            itemCount: imported.length,
            created,
            updated,
            linked,
            manualInventoryLinks: true,
            skus: imported.map((row) => row.sku)
          }
        }
      });
    }

    return { created, updated, linked, total: imported.length, items: imported };
  });
}

module.exports = {
  confirmImportLinked,
  normalizeConfirmItems
};
