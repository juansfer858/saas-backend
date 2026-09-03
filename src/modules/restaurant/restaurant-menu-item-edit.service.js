'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const CATEGORY_DESCRIPTION_PREFIX = 'Categoría de carta: ';
const MENU_CATEGORIES = new Set(['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES']);
const STATIONS = new Set(['COCINA', 'BARRA', 'POSTRES']);

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicRow(menuItem, product, commercialCategory) {
  return {
    id: menuItem.id,
    productId: product.id,
    category: commercialCategory,
    subcategory: product.nombre,
    price: Number(product.precio1 || 0),
    operationalCategory: menuItem.category,
    station: menuItem.station,
    importedByOcr: true
  };
}

async function updateImportedCartaItem(tenantId, userId, menuItemId, input) {
  const category = cleanText(input?.category, 80);
  const subcategory = cleanText(input?.subcategory, 180);
  const price = Number(input?.price);
  const operationalCategory = String(input?.operationalCategory || '').trim().toUpperCase();
  const station = String(input?.station || '').trim().toUpperCase();

  if (!category || !subcategory || !Number.isFinite(price) || price <= 0) {
    throw new AppError(400, 'Categoría, producto y precio son obligatorios', 'RESTAURANT_MENU_OCR_EDIT_INVALID');
  }
  if (!MENU_CATEGORIES.has(operationalCategory)) {
    throw new AppError(400, 'Categoría operativa inválida', 'RESTAURANT_MENU_OCR_EDIT_CATEGORY_INVALID');
  }
  if (!STATIONS.has(station)) {
    throw new AppError(400, 'Estación inválida', 'RESTAURANT_MENU_OCR_EDIT_STATION_INVALID');
  }

  return prisma.$transaction(async (tx) => {
    const menuItem = await tx.restaurantMenuItem.findFirst({
      where: { id: menuItemId, tenantId, active: true }
    });
    if (!menuItem) {
      throw new AppError(404, 'Producto de carta no encontrado', 'RESTAURANT_MENU_OCR_EDIT_NOT_FOUND');
    }

    const product = await tx.producto.findFirst({
      where: { id: menuItem.productId, tenantId, activo: true }
    });
    if (!product) {
      throw new AppError(404, 'Producto vinculado no encontrado', 'RESTAURANT_MENU_OCR_EDIT_PRODUCT_NOT_FOUND');
    }
    if (!String(product.sku || '').startsWith('MENU-OCR-')) {
      throw new AppError(409, 'Este producto no fue creado por la importación de carta', 'RESTAURANT_MENU_OCR_EDIT_ONLY_IMPORTED');
    }

    const before = {
      category: String(product.descripcion || '').startsWith(CATEGORY_DESCRIPTION_PREFIX)
        ? String(product.descripcion).slice(CATEGORY_DESCRIPTION_PREFIX.length)
        : null,
      subcategory: product.nombre,
      price: Number(product.precio1 || 0),
      operationalCategory: menuItem.category,
      station: menuItem.station
    };

    const updatedProduct = await tx.producto.update({
      where: { id: product.id },
      data: {
        nombre: subcategory,
        descripcion: `${CATEGORY_DESCRIPTION_PREFIX}${category}`,
        precio1: price
      }
    });
    const updatedMenuItem = await tx.restaurantMenuItem.update({
      where: { id: menuItem.id },
      data: { category: operationalCategory, station }
    });

    if (userId) {
      await tx.auditoriaContable.create({
        data: {
          tenantId,
          userId,
          entidad: 'RESTAURANT_MENU_OCR_ITEM',
          entidadId: menuItem.id,
          accion: 'UPDATE',
          metadata: {
            productId: product.id,
            sku: product.sku,
            before,
            after: { category, subcategory, price, operationalCategory, station }
          }
        }
      });
    }

    return publicRow(updatedMenuItem, updatedProduct, category);
  });
}

module.exports = { updateImportedCartaItem };
