'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const MARKER = 'VANTIX_RESTAURANT_COMMERCIAL_CATEGORIES_V26';
const PREFIX = 'Categoría de carta: ';
const DEFAULT_CATEGORIES = Object.freeze(['Entradas', 'Fuertes', 'Bebidas', 'Postres']);

function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function normalizedName(value) {
  return cleanName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function defaultCommercialCategory(category) {
  const value = String(category || '').toUpperCase();
  if (value === 'ENTRADAS') return 'Entradas';
  if (value === 'BEBIDAS') return 'Bebidas';
  if (value === 'POSTRES') return 'Postres';
  return 'Fuertes';
}

function legacyCategory(description, fallback = 'Carta') {
  const value = String(description || '').trim();
  if (value.toLowerCase().startsWith(PREFIX.toLowerCase())) {
    return cleanName(value.slice(PREFIX.length)) || fallback;
  }
  return fallback;
}

async function nextSortOrder(tenantId, client = prisma) {
  const aggregate = await client.restaurantCommercialCategory.aggregate({
    where: { tenantId },
    _max: { sortOrder: true }
  });
  return Number(aggregate?._max?.sortOrder ?? -10) + 10;
}

async function findByName(tenantId, name, client = prisma) {
  const key = normalizedName(name);
  if (!key) return null;
  return client.restaurantCommercialCategory.findUnique({
    where: { tenantId_normalizedName: { tenantId, normalizedName: key } }
  });
}

async function ensureCategory(tenantId, name, client = prisma, sortOrder = null) {
  const categoryName = cleanName(name);
  const key = normalizedName(categoryName);
  if (!categoryName || !key) throw new AppError(400, 'El nombre de la categoría es obligatorio', 'RESTAURANT_COMMERCIAL_CATEGORY_NAME_REQUIRED');

  const existing = await findByName(tenantId, categoryName, client);
  if (existing) return existing;

  const order = sortOrder === null ? await nextSortOrder(tenantId, client) : Number(sortOrder || 0);
  try {
    return await client.restaurantCommercialCategory.create({
      data: { tenantId, name: categoryName, normalizedName: key, sortOrder: order, active: true }
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const concurrent = await findByName(tenantId, categoryName, client);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

async function ensureCatalog(tenantId, client = prisma) {
  const menuRows = await client.restaurantMenuItem.findMany({
    where: { tenantId },
    select: { id: true, productId: true, category: true, commercialCategoryId: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
  });

  let categories = await client.restaurantCommercialCategory.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
  });

  if (!menuRows.length && !categories.length) {
    for (let index = 0; index < DEFAULT_CATEGORIES.length; index += 1) {
      await ensureCategory(tenantId, DEFAULT_CATEGORIES[index], client, index * 10);
    }
    return client.restaurantCommercialCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
    });
  }

  const missing = menuRows.filter((row) => !row.commercialCategoryId);
  if (missing.length) {
    const productIds = [...new Set(missing.map((row) => row.productId).filter(Boolean))];
    const products = productIds.length ? await client.producto.findMany({
      where: { tenantId, id: { in: productIds } },
      select: { id: true, descripcion: true }
    }) : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const categoryByKey = new Map(categories.map((category) => [category.normalizedName, category]));

    for (const row of missing) {
      const fallback = defaultCommercialCategory(row.category);
      const name = legacyCategory(productById.get(row.productId)?.descripcion, fallback);
      const key = normalizedName(name);
      let category = categoryByKey.get(key);
      if (!category) {
        category = await ensureCategory(tenantId, name, client);
        categoryByKey.set(key, category);
        categories.push(category);
      }
      await client.restaurantMenuItem.updateMany({
        where: { id: row.id, tenantId, commercialCategoryId: null },
        data: { commercialCategoryId: category.id }
      });
    }
  }

  return client.restaurantCommercialCategory.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
  });
}

async function listCategories(tenantId, options = {}) {
  await ensureCatalog(tenantId);
  const where = { tenantId };
  if (!options.includeInactive) where.active = true;
  const [categories, menuRows] = await Promise.all([
    prisma.restaurantCommercialCategory.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
    }),
    prisma.restaurantMenuItem.findMany({
      where: { tenantId, commercialCategoryId: { not: null } },
      select: { commercialCategoryId: true }
    })
  ]);
  const counts = new Map();
  for (const row of menuRows) counts.set(row.commercialCategoryId, Number(counts.get(row.commercialCategoryId) || 0) + 1);
  return categories.map((category) => ({ ...category, productCount: Number(counts.get(category.id) || 0) }));
}

async function createCategory(tenantId, input) {
  await ensureCatalog(tenantId);
  const name = cleanName(input?.name);
  if (!name) throw new AppError(400, 'Escribe un nombre para la categoría', 'RESTAURANT_COMMERCIAL_CATEGORY_NAME_REQUIRED');
  const existing = await findByName(tenantId, name);
  if (existing) throw new AppError(409, 'Ya existe una categoría con ese nombre', 'RESTAURANT_COMMERCIAL_CATEGORY_DUPLICATE');
  return ensureCategory(tenantId, name, prisma, input?.sortOrder ?? null);
}

async function updateLegacyLabels(tx, tenantId, categoryId, name) {
  const menuRows = await tx.restaurantMenuItem.findMany({
    where: { tenantId, commercialCategoryId: categoryId },
    select: { productId: true }
  });
  const productIds = [...new Set(menuRows.map((row) => row.productId).filter(Boolean))];
  if (!productIds.length) return;
  const products = await tx.producto.findMany({
    where: { tenantId, id: { in: productIds } },
    select: { id: true, descripcion: true }
  });
  for (const product of products) {
    const current = String(product.descripcion || '').trim();
    if (!current || current.toLowerCase().startsWith(PREFIX.toLowerCase())) {
      await tx.producto.update({ where: { id: product.id }, data: { descripcion: `${PREFIX}${name}` } });
    }
  }
}

async function updateCategory(tenantId, id, input) {
  const current = await prisma.restaurantCommercialCategory.findFirst({ where: { id, tenantId } });
  if (!current) throw new AppError(404, 'Categoría no encontrada', 'RESTAURANT_COMMERCIAL_CATEGORY_NOT_FOUND');

  const data = {};
  if (Object.prototype.hasOwnProperty.call(input || {}, 'name')) {
    const name = cleanName(input.name);
    if (!name) throw new AppError(400, 'El nombre de la categoría es obligatorio', 'RESTAURANT_COMMERCIAL_CATEGORY_NAME_REQUIRED');
    const key = normalizedName(name);
    const duplicate = await prisma.restaurantCommercialCategory.findFirst({
      where: { tenantId, normalizedName: key, id: { not: id } }
    });
    if (duplicate) throw new AppError(409, 'Ya existe una categoría con ese nombre', 'RESTAURANT_COMMERCIAL_CATEGORY_DUPLICATE');
    data.name = name;
    data.normalizedName = key;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, 'sortOrder')) data.sortOrder = Number(input.sortOrder || 0);
  if (Object.prototype.hasOwnProperty.call(input || {}, 'active')) {
    const active = Boolean(input.active);
    if (!active) {
      const assigned = await prisma.restaurantMenuItem.count({ where: { tenantId, commercialCategoryId: id } });
      if (assigned > 0) throw new AppError(409, 'Mueve primero los productos de esta categoría antes de desactivarla', 'RESTAURANT_COMMERCIAL_CATEGORY_IN_USE');
    }
    data.active = active;
  }
  if (!Object.keys(data).length) throw new AppError(400, 'No se enviaron cambios', 'RESTAURANT_COMMERCIAL_CATEGORY_NO_CHANGES');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.restaurantCommercialCategory.update({ where: { id }, data });
    if (data.name && data.name !== current.name) await updateLegacyLabels(tx, tenantId, id, data.name);
    return updated;
  });
}

async function assignMenuItem(tenantId, menuItemId, categoryId) {
  return prisma.$transaction(async (tx) => {
    const [menuItem, category] = await Promise.all([
      tx.restaurantMenuItem.findFirst({ where: { id: menuItemId, tenantId } }),
      tx.restaurantCommercialCategory.findFirst({ where: { id: categoryId, tenantId, active: true } })
    ]);
    if (!menuItem) throw new AppError(404, 'Producto de carta no encontrado', 'RESTAURANT_COMMERCIAL_CATEGORY_MENU_NOT_FOUND');
    if (!category) throw new AppError(400, 'Selecciona una categoría comercial activa', 'RESTAURANT_COMMERCIAL_CATEGORY_INVALID');

    const updated = await tx.restaurantMenuItem.update({
      where: { id: menuItem.id },
      data: { commercialCategoryId: category.id }
    });
    const product = await tx.producto.findFirst({ where: { id: menuItem.productId, tenantId } });
    const currentDescription = String(product?.descripcion || '').trim();
    if (product && (!currentDescription || currentDescription.toLowerCase().startsWith(PREFIX.toLowerCase()))) {
      await tx.producto.update({ where: { id: product.id }, data: { descripcion: `${PREFIX}${category.name}` } });
    }
    return { menuItem: updated, category };
  });
}

async function assignMenuItemByName(tenantId, menuItemId, name) {
  const category = await ensureCategory(tenantId, name);
  if (!category.active) {
    await prisma.restaurantCommercialCategory.update({ where: { id: category.id }, data: { active: true } });
  }
  return assignMenuItem(tenantId, menuItemId, category.id);
}

async function categoryMapForRows(tenantId, rows, client = prisma) {
  const inputRows = Array.isArray(rows) ? rows : [];
  if (!inputRows.length) return new Map();
  const menuIds = [...new Set(inputRows.map((row) => row?.id).filter(Boolean))];
  const missing = inputRows.some((row) => !row?.commercialCategoryId);
  let assignments = inputRows.map((row) => ({ id: row.id, commercialCategoryId: row.commercialCategoryId || null }));
  if (missing) {
    await ensureCatalog(tenantId, client);
    assignments = await client.restaurantMenuItem.findMany({
      where: { tenantId, id: { in: menuIds } },
      select: { id: true, commercialCategoryId: true }
    });
  }
  const categoryIds = [...new Set(assignments.map((row) => row.commercialCategoryId).filter(Boolean))];
  const categories = categoryIds.length ? await client.restaurantCommercialCategory.findMany({
    where: { tenantId, id: { in: categoryIds }, active: true }
  }) : [];
  const byCategoryId = new Map(categories.map((category) => [category.id, category]));
  const result = new Map();
  for (const assignment of assignments) {
    const category = byCategoryId.get(assignment.commercialCategoryId);
    if (category) result.set(assignment.id, category);
  }
  return result;
}

async function decorateMenuRows(tenantId, rows, client = prisma) {
  const inputRows = Array.isArray(rows) ? rows : [];
  const categoryMap = await categoryMapForRows(tenantId, inputRows, client);
  return inputRows.map((row) => {
    const central = categoryMap.get(row.id);
    const fallback = legacyCategory(row?.product?.descripcion, defaultCommercialCategory(row?.category));
    return {
      ...row,
      commercialCategoryId: central?.id || row?.commercialCategoryId || null,
      displayCategory: central?.name || fallback,
      commercialCategory: central ? { id: central.id, name: central.name } : null
    };
  });
}

async function decorateCartaRows(tenantId, rows) {
  const inputRows = Array.isArray(rows) ? rows : [];
  if (!inputRows.length) {
    await ensureCatalog(tenantId);
    return [];
  }
  const categoryMap = await categoryMapForRows(tenantId, inputRows);
  return inputRows.map((row) => {
    const central = categoryMap.get(row.id);
    return {
      ...row,
      categoryId: central?.id || row?.commercialCategoryId || null,
      category: central?.name || cleanName(row.category) || defaultCommercialCategory(row.operationalCategory)
    };
  });
}

module.exports = {
  MARKER,
  PREFIX,
  DEFAULT_CATEGORIES,
  cleanName,
  normalizedName,
  defaultCommercialCategory,
  legacyCategory,
  ensureCatalog,
  listCategories,
  createCategory,
  updateCategory,
  assignMenuItem,
  assignMenuItemByName,
  categoryMapForRows,
  decorateMenuRows,
  decorateCartaRows
};
