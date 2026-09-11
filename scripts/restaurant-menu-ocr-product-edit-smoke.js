'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
const v2PublicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-menu.public.routes.js', 'utf8');
const editService = fs.readFileSync('src/modules/restaurant/restaurant-menu-item-edit.service.js', 'utf8');
const editUi = fs.readFileSync('src/web/restaurant-menu-ocr-product-edit-v6.js', 'utf8');
const cartaEditUi = fs.readFileSync('src/web/restaurant-v2-menu-edit-v27.js', 'utf8');
const cartaHtml = fs.readFileSync('src/web/restaurant-v2-menu.html', 'utf8');

assert.match(routes, /carta-importacion\/items\/:id/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(routes, /updateImportedCartaItem/);
assert.match(routes, /editImportedItemSchema/);
assert.match(routes, /operationalCategory/);
assert.match(routes, /station/);
assert.match(routes, /carta-importacion\/items\/:id\/editar-v27/);
assert.match(routes, /updateCartaItem/);
assert.match(routes, /editCartaItemSchema/);

assert.match(editService, /prisma\.\$transaction/);
assert.match(editService, /MENU-OCR-/);
assert.match(editService, /RESTAURANT_MENU_OCR_EDIT_ONLY_IMPORTED/);
assert.match(editService, /RESTAURANT_MENU_OCR_ITEM/);
assert.match(editService, /Categoría de carta:/);
assert.match(editService, /precio1: price/);
assert.match(editService, /VANTIX_RESTAURANT_CARTA_EDIT_V27/);
assert.match(editService, /async function updateCartaItem/);
assert.match(editService, /commercialCategoryId: commercialCategory\.id/);
assert.match(editService, /controlaInventario: mode === 'DIRECT'/);
assert.match(editService, /requiresRecipe: mode === 'RECIPE'/);

assert.match(publicRoutes, /restaurant-menu-ocr-product-edit-v6\.js/);
assert.match(publicRoutes, /browserProductEditMarker: 'VANTIX_MENU_OCR_EDIT_V6'/);
assert.match(publicRoutes, /X-VantixGC-Menu-OCR-Product-Edit/);

assert.match(editUi, /VANTIX_MENU_OCR_EDIT_V6/);
assert.match(editUi, /data-edit-ocr/);
assert.match(editUi, />Editar</);
assert.match(editUi, /Guardar cambios/);
assert.match(editUi, /method:'PATCH'/);
assert.match(editUi, /carta-importacion\/items\//);
assert.match(editUi, /Categoría de la carta/);
assert.match(editUi, /Producto \/ sabor/);
assert.match(editUi, /Tipo operativo/);
assert.match(editUi, /Estación/);
assert.doesNotThrow(() => new vm.Script(editUi), 'editor browser runtime must remain valid JavaScript');

assert.match(cartaEditUi, /VANTIX_RESTAURANT_CARTA_EDIT_V27/);
assert.match(cartaEditUi, /document\.addEventListener\('submit', save, true\)/);
assert.match(cartaEditUi, /event\.stopImmediatePropagation\(\)/);
assert.match(cartaEditUi, /editar-v27/);
assert.match(cartaEditUi, /categoryId/);
assert.match(cartaEditUi, /Guardar cambios/);
assert.doesNotMatch(cartaEditUi, /\bdescription\b/);
assert.doesNotThrow(() => new vm.Script(cartaEditUi), 'Carta V27 browser runtime must remain valid JavaScript');

assert.match(v2PublicRoutes, /restaurant-v2-menu-edit-v27\.js/);
assert.match(cartaHtml, /restaurant-v2-menu\.js\?v=v27/);
assert.match(cartaHtml, /restaurant-v2-menu-edit-v27\.js\?v=v27/);

console.log('RESTAURANT MENU OCR PRODUCT EDIT CONTRACT OK', JSON.stringify({ cartaEditV27:true, staleRuntimeBypassed:true }));
