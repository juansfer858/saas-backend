'use strict';

const express = require('express');
const path = require('node:path');
const { prisma } = require('../../config/prisma');
const identity = require('./restaurant-identity.service');
const menuImport = require('./restaurant-menu-import.service');
const commercialCategories = require('./restaurant-commercial-categories-v26.service');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p7-permanent-qr-client';
const MARKER = 'VANTIX_RESTAURANT_V2_CLIENT_QR_P7';
const CATEGORY_MARKER = 'VANTIX_RESTAURANT_V2_QR_COMMERCIAL_CATEGORIES_V1';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Client-QR', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}

function defaultCommercialCategory(category) {
  return commercialCategories.defaultCommercialCategory(category);
}

function decorateMenuCategories(menu, menuRows, products, categoryRows = []) {
  const productById = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product]));
  const categoryById = new Map((Array.isArray(categoryRows) ? categoryRows : []).filter((category) => category?.active !== false).map((category) => [category.id, category]));
  const menuById = new Map((Array.isArray(menuRows) ? menuRows : []).map((row, index) => [row.id, { ...row, rank:index }]));

  return (Array.isArray(menu) ? menu : []).map((item, originalIndex) => {
    const source = menuById.get(item.id);
    const operationalCategory = String(source?.category || item.operationalCategory || item.category || 'FUERTES').toUpperCase();
    const fallback = defaultCommercialCategory(operationalCategory);
    const product = source ? productById.get(source.productId) : null;
    const central = source?.commercialCategoryId ? categoryById.get(source.commercialCategoryId) : null;
    const commercialCategory = central?.name || item.displayCategory || menuImport.publicCategoryFromDescription(product?.descripcion, fallback);
    return {
      ...item,
      category: commercialCategory,
      displayCategory: commercialCategory,
      commercialCategoryId: central?.id || source?.commercialCategoryId || null,
      operationalCategory,
      sortOrder: Number(source?.sortOrder ?? originalIndex),
      __rank: Number(source?.rank ?? originalIndex)
    };
  }).sort((a, b) => a.__rank - b.__rank).map(({ __rank, ...item }) => item);
}

async function commercializeQrContext(context) {
  const menu = Array.isArray(context?.menu) ? context.menu : [];
  if (!menu.length || !context?.tenantId) return context;

  const menuIds = [...new Set(menu.map((item) => item?.id).filter(Boolean))];
  let menuRows = menuIds.length ? await prisma.restaurantMenuItem.findMany({
    where: { tenantId: context.tenantId, id: { in: menuIds }, active: true },
    select: { id: true, productId: true, category: true, commercialCategoryId: true, sortOrder: true, creadoEn: true },
    orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
  }) : [];

  if (menuRows.some((row) => !row.commercialCategoryId)) {
    await commercialCategories.ensureCatalog(context.tenantId);
    menuRows = await prisma.restaurantMenuItem.findMany({
      where: { tenantId: context.tenantId, id: { in: menuIds }, active: true },
      select: { id: true, productId: true, category: true, commercialCategoryId: true, sortOrder: true, creadoEn: true },
      orderBy: [{ sortOrder: 'asc' }, { creadoEn: 'asc' }]
    });
  }

  const productIds = [...new Set(menuRows.map((row) => row.productId).filter(Boolean))];
  const categoryIds = [...new Set(menuRows.map((row) => row.commercialCategoryId).filter(Boolean))];
  const [products, categoryRows] = await Promise.all([
    productIds.length ? prisma.producto.findMany({
      where: { tenantId: context.tenantId, id: { in: productIds }, activo: true },
      select: { id: true, descripcion: true }
    }) : [],
    categoryIds.length ? prisma.restaurantCommercialCategory.findMany({
      where: { tenantId: context.tenantId, id: { in: categoryIds }, active: true }
    }) : []
  ]);

  return { ...context, menu:decorateMenuCategories(menu, menuRows, products, categoryRows) };
}

// P7 owns the existing physical QR URL without changing the token contract.
// This router is mounted before every V1 QR wrapper. Removing this module makes
// src/app.js' existing /r/:token handler the automatic legacy fallback again.
router.get('/r/:token', (_req, res) => send(res, 'restaurant-v2-client-qr.html', 'html'));

// The public QR shows the tenant's commercial Carta categories while the four
// operational categories remain internal routing metadata for Cocina/Barra/Postres.
router.get('/api/public/restaurante/qr/:token', async (req, res, next) => {
  try {
    const context = await identity.publicQrContext(req.params.token);
    const data = await commercializeQrContext(context);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-Restaurant-QR-Categories', `${CATEGORY_MARKER}; v26-central`);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/app/restaurant-v2-client-qr.js', (_req, res) => send(res, 'restaurant-v2-client-qr.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-client-qr-open-request.js', (_req, res) => send(res, 'restaurant-v2-client-qr-open-request.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-client-qr.css', (_req, res) => send(res, 'restaurant-v2-client-qr.css', 'text/css; charset=utf-8'));

module.exports = {
  HEADER_VALUE,
  MARKER,
  CATEGORY_MARKER,
  defaultCommercialCategory,
  decorateMenuCategories,
  commercializeQrContext,
  restaurantV2ClientQrPublicRouter: router
};
