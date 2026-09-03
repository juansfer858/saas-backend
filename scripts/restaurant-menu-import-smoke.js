'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const service = require('../src/modules/restaurant/restaurant-menu-import.service');
const { patchMenuImportUpload10Mb } = require('../src/modules/restaurant/restaurant-menu-import.public.routes');
const edgeIngress = require('../src/modules/edge/edge-restaurant-ingress.service');

const rows = service.normalizeItems([
  { category:'Hamburguesas', subcategory:'Ranchera', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.94 },
  { category:' Hamburguesas ', subcategory:' Ranchera ', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.80 },
  { category:'Bebidas', subcategory:'Limonada natural', price:9000, operationalCategory:'INVALID', station:'INVALID', confidence:.9 },
  { category:'Sin precio', subcategory:'No importar', price:0 }
]);

assert.equal(rows.length, 2, 'normalizer must discard invalid rows and dedupe same menu item');
assert.deepEqual(rows[0], { category:'Hamburguesas', subcategory:'Ranchera', price:25000, operationalCategory:'FUERTES', station:'COCINA', confidence:.94 });
assert.equal(rows[1].operationalCategory, 'BEBIDAS');
assert.equal(rows[1].station, 'BARRA');

const sku1 = service.menuSku('Hamburguesas', 'Ranchera');
const sku2 = service.menuSku(' hamburguesas ', 'RANCHERA');
const sku3 = service.menuSku('Hamburguesas', 'Clásica');
assert.equal(sku1, sku2, 'same category/name must generate stable SKU across casing/spacing');
assert.notEqual(sku1, sku3, 'different variants must not collide in normal cases');
assert.match(sku1, /^MENU-OCR-[A-F0-9]{16}$/);
assert.equal(service.publicCategoryFromDescription('Categoría de carta: Hamburguesas', 'Fuertes'), 'Hamburguesas');
assert.equal(service.publicCategoryFromDescription('Descripción libre', 'Fuertes'), 'Fuertes');

const ui = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
const theme = fs.readFileSync('src/web/restaurant-theme.js', 'utf8');
const coreRoutes = fs.readFileSync('src/routes/core.routes.js', 'utf8');

assert.match(ui, /Importar carta \(foto\/PDF\)/);
assert.match(ui, /Categoría/);
assert.match(ui, /Producto \/ sabor/);
assert.match(ui, /Precio/);
assert.match(ui, /No se importan las fotos de la carta/);
assert.match(ui, /imageToJpeg/);
assert.match(ui, /carta-importacion\/analizar/);
assert.match(ui, /carta-importacion\/confirmar/);
assert.match(routes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(routes, /application\/pdf/);
assert.match(publicRoutes, /restaurant-menu-import-ui\.js/);
assert.match(theme, /location\.pathname\.startsWith\('\/app\/centro-de-control'\)/);
assert.match(coreRoutes, /restaurantMenuImportRouter/);

const status = service.providerStatus();
assert.equal(typeof status.configured, 'boolean');
assert.ok(['NONE','OPENAI','CUSTOM_HTTP'].includes(status.provider));
assert.equal(service.MAX_FILE_BYTES, 10 * 1024 * 1024, 'menu OCR limit must be exactly 10 MiB');
assert.equal(status.maxBytes, 10 * 1024 * 1024, 'provider status must publish the 10 MiB limit');

assert.match(routes, /carta-importacion\/analizar-binario/);
assert.match(routes, /application\/octet-stream/);
assert.match(routes, /limit: service\.MAX_FILE_BYTES/);
assert.match(routes, /RESTAURANT_MENU_OCR_FILE_TOO_LARGE/);

const servedUi = patchMenuImportUpload10Mb(ui);
assert.match(servedUi, /VANTIX_MENU_OCR_UPLOAD_10MB_V5/);
assert.match(servedUi, /const MAX_BYTES = 10 \* 1024 \* 1024;/);
assert.match(servedUi, /carta-importacion\/analizar-binario/);
assert.match(servedUi, /Content-Type':'application\/octet-stream/);
assert.doesNotMatch(servedUi, /const dataBase64 = dataUrl\.split\(','\)\[1\]/, 'served uploader must not Base64-expand the HTTP request');
assert.doesNotThrow(() => new vm.Script(servedUi), 'final browser OCR runtime must remain valid JavaScript');

const now = Date.now();
assert.equal(edgeIngress.EDGE_HEARTBEAT_ONLINE_MS, 90_000, 'Edge ingress online window is an explicit 90 seconds');
assert.equal(edgeIngress.heartbeatOnline(new Date(now - 89_000), now), true, 'recent Edge heartbeat must remain cloud-available');
assert.equal(edgeIngress.heartbeatOnline(new Date(now - 91_000), now), false, 'stale Edge heartbeat must force the guarded local fallback');

console.log('RESTAURANT MENU OCR CONTRACT SMOKE OK', JSON.stringify({
  maxBytes: service.MAX_FILE_BYTES,
  uploadMode: 'BINARY',
  edgeHeartbeatOnlineMs: edgeIngress.EDGE_HEARTBEAT_ONLINE_MS
}));
