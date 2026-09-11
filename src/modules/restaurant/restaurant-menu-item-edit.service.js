'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const commercialCategories = require('./restaurant-commercial-categories-v26.service');

const CATEGORY_DESCRIPTION_PREFIX = 'Categoría de carta: ';
const MENU_CATEGORIES = new Set(['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES']);
const STATIONS = new Set(['COCINA', 'BARRA', 'POSTRES']);
const CONTROL_MODES = new Set(['PREPARED', 'DIRECT', 'RECIPE']);
const CARTA_EDIT_MARKER = 'VANTIX_RESTAURANT_CARTA_EDIT_V27';

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicRow(menuItem, product, commercialCategory) {
  return {
    id: menuItem.id,
    menuItemId: menuItem.id,
    productId: product.id,
    category: commercialCategory,
    subcategory: product.nombre,
    price: Number(product.precio1 || 0),
    operationalCategory: menuItem.category,
    station: menuItem.station,
    active: menuItem.active !== false,
    commercialCategoryId: menuItem.commercialCategoryId || null,
    importedByOcr: String(product.sku || '').startsWith('MENU-OCR-')
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

async function resolveCommercialCategory(tx, tenantId, input) {
  const categoryId = cleanText(input?.categoryId, 80);
  const categoryName = cleanText(input?.category, 80);
  let category = null;

  if (categoryId) {
    category = await tx.restaurantCommercialCategory.findFirst({
      where: { id: categoryId, tenantId, active: true }
    });
  }

  if (!category && categoryName) {
    category = await tx.restaurantCommercialCategory.findUnique({
      where: {
        tenantId_normalizedName: {
          tenantId,
          normalizedName: commercialCategories.normalizedName(categoryName)
        }
      }
    });
    if (category?.active === false) category = null;
  }

  if (!category) {
    throw new AppError(400, 'Selecciona una categoría comercial activa', 'RESTAURANT_CARTA_EDIT_COMMERCIAL_CATEGORY_INVALID');
  }
  return category;
}

async function updateCartaItem(tenantId, userId, menuItemId, input) {
  const name = cleanText(input?.name, 180);
  const price = Number(input?.price);
  const operationalCategory = String(input?.operationalCategory || '').trim().toUpperCase();
  const station = String(input?.station || '').trim().toUpperCase();
  const mode = String(input?.mode || '').trim().toUpperCase();
  const active = input?.active !== false;

  if (!name || !Number.isFinite(price) || price < 0) {
    throw new AppError(400, 'Nombre y precio válidos son obligatorios', 'RESTAURANT_CARTA_EDIT_INVALID');
  }
  if (!MENU_CATEGORIES.has(operationalCategory)) {
    throw new AppError(400, 'Categoría operativa inválida', 'RESTAURANT_CARTA_EDIT_CATEGORY_INVALID');
  }
  if (!STATIONS.has(station)) {
    throw new AppError(400, 'Estación inválida', 'RESTAURANT_CARTA_EDIT_STATION_INVALID');
  }
  if (!CONTROL_MODES.has(mode)) {
    throw new AppError(400, 'Modo de control inválido', 'RESTAURANT_CARTA_EDIT_MODE_INVALID');
  }

  return prisma.$transaction(async (tx) => {
    const menuItem = await tx.restaurantMenuItem.findFirst({
      where: { id: menuItemId, tenantId }
    });
    if (!menuItem) {
      throw new AppError(404, 'Producto de carta no encontrado', 'RESTAURANT_CARTA_EDIT_NOT_FOUND');
    }

    const product = await tx.producto.findFirst({
      where: { id: menuItem.productId, tenantId, activo: true }
    });
    if (!product) {
      throw new AppError(404, 'Producto vinculado no encontrado', 'RESTAURANT_CARTA_EDIT_PRODUCT_NOT_FOUND');
    }

    const commercialCategory = await resolveCommercialCategory(tx, tenantId, input);
    const recipe = await tx.consumptionRecipe.findFirst({
      where: { tenantId, outputProductId: product.id },
      orderBy: { creadoEn: 'desc' }
    });

    if (mode === 'RECIPE' && !recipe) {
      throw new AppError(409, 'Primero configura la receta de este producto', 'RESTAURANT_CARTA_EDIT_RECIPE_REQUIRED');
    }

    const currentDescription = String(product.descripcion || '').trim();
    const nextDescription = !currentDescription || currentDescription.toLowerCase().startsWith(CATEGORY_DESCRIPTION_PREFIX.toLowerCase())
      ? `${CATEGORY_DESCRIPTION_PREFIX}${commercialCategory.name}`
      : currentDescription;

    const before = {
      name: product.nombre,
      price: Number(product.precio1 || 0),
      category: menuItem.category,
      commercialCategoryId: menuItem.commercialCategoryId || null,
      station: menuItem.station,
      mode: menuItem.requiresRecipe ? 'RECIPE' : (product.controlaInventario ? 'DIRECT' : 'PREPARED'),
      active: menuItem.active !== false
    };

    if (recipe) {
      await tx.consumptionRecipe.update({
        where: { id: recipe.id },
        data: { active: mode === 'RECIPE' }
      });
    }

    const updatedProduct = await tx.producto.update({
      where: { id: product.id },
      data: {
        nombre: name,
        precio1: price,
        descripcion: nextDescription,
        controlaInventario: mode === 'DIRECT'
      }
    });

    const updatedMenuItem = await tx.restaurantMenuItem.update({
      where: { id: menuItem.id },
      data: {
        category: operationalCategory,
        commercialCategoryId: commercialCategory.id,
        station,
        requiresRecipe: mode === 'RECIPE',
        active
      }
    });

    if (userId) {
      await tx.auditoriaContable.create({
        data: {
          tenantId,
          userId,
          entidad: 'RESTAURANT_CARTA_ITEM',
          entidadId: menuItem.id,
          accion: 'UPDATE',
          metadata: {
            marker: CARTA_EDIT_MARKER,
            productId: product.id,
            sku: product.sku,
            before,
            after: {
              name,
              price,
              category: operationalCategory,
              commercialCategoryId: commercialCategory.id,
              commercialCategory: commercialCategory.name,
              station,
              mode,
              active
            }
          }
        }
      });
    }

    return {
      ...publicRow(updatedMenuItem, updatedProduct, commercialCategory.name),
      marker: CARTA_EDIT_MARKER,
      mode
    };
  });
}

module.exports = { CARTA_EDIT_MARKER, updateImportedCartaItem, updateCartaItem };
