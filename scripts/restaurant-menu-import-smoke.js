'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const service = require('../src/modules/restaurant/restaurant-menu-import.service');
const {
  patchMenuImportUpload10Mb,
  patchBrowserOcr10Mb,
  patchDynamicCommercialCategories,
  buildMenuImportBrowserAsset
} = require('../src/modules/restaurant/restaurant-menu-import.public.routes');
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
assert.equal(service.publicCategoryFromDescription('Categoría de carta: Girasoles - Helados', 'Postres'), 'Girasoles - Helados');
assert.equal(service.publicCategoryFromDescription('Descripción libre', 'Fuertes'), 'Fuertes');

const ui = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
const layoutOcr = fs.readFileSync('src/web/restaurant-menu-layout-parser-v3.js', 'utf8');
const browserOcr = fs.readFileSync('src/web/restaurant-menu-browser-ocr.js', 'utf8');
const browserOcrV4 = fs.readFileSync('src/web/restaurant-menu-browser-ocr-v4.js', 'utf8');
const qualityOcr = fs.readFileSync('src/web/restaurant-menu-ocr-quality-v2.js', 'utf8');
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
assert.match(servedUi, /VANTIX_MENU_OCR_END_TO_END_10MB_V7/);
assert.match(servedUi, /const MAX_BYTES = 10 \* 1024 \* 1024;/);
assert.match(servedUi, /status\.provider \|\| ''\)\.toUpperCase\(\) === 'BROWSER_OCR'/);
assert.match(servedUi, /carta-importacion\/analizar-binario/);
assert.match(servedUi, /Content-Type':'application\/octet-stream/);
assert.match(servedUi, /carta-importacion\/analizar'/, 'browser fallback must keep the local OCR route');
assert.doesNotThrow(() => new vm.Script(servedUi), 'patched main browser OCR runtime must remain valid JavaScript');

const patchedBrowserOcr = patchDynamicCommercialCategories(patchBrowserOcr10Mb(browserOcr));
const patchedBrowserOcrV4 = patchBrowserOcr10Mb(browserOcrV4);
const patchedLayoutOcr = patchDynamicCommercialCategories(layoutOcr);
const patchedQualityOcr = patchDynamicCommercialCategories(qualityOcr);
for (const [name, source] of [['browser-v1', patchedBrowserOcr], ['browser-v4', patchedBrowserOcrV4]]) {
  assert.match(source, /const MAX_BYTES = 10 \* 1024 \* 1024;/, `${name} must advertise 10 MiB`);
  assert.doesNotMatch(source, /MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/, `${name} must not retain 5 MiB`);
  assert.doesNotMatch(source, /Máximo 5 MB|máximo de 5 MB/, `${name} must not expose a 5 MB error`);
  assert.doesNotThrow(() => new vm.Script(source), `${name} must remain valid JavaScript`);
}

for (const [name, source] of [['browser-v1', patchedBrowserOcr], ['layout-v3', patchedLayoutOcr], ['quality-v2', patchedQualityOcr]]) {
  assert.match(source, /VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8/, `${name} must carry dynamic category marker`);
  assert.doesNotMatch(source, /commercial\s*=\s*family\s*\|\|/, `${name} must not override a detected heading with an inferred family`);
  assert.doesNotMatch(source, /category\s*=\s*family\(name\)\s*\|\|\s*clean\(item\.category/, `${name} must preserve provider/browser category`);
  assert.doesNotMatch(source, /category\s*=\s*family\s*\|\|\s*explicitCategory/, `${name} must prioritize visible layout category`);
  assert.doesNotThrow(() => new vm.Script(source), `${name} dynamic category patch must remain valid JavaScript`);
}

const browserContext = {
  window: {
    fetch: async () => new Response(JSON.stringify({ ok:false }), { status:503, headers:{ 'Content-Type':'application/json' } }),
    VantixGCRestaurantLayoutOcrV3: null
  },
  location: { origin:'https://core.vantixgc.com' },
  URL,
  Response,
  Blob,
  Uint8Array,
  atob,
  console
};
browserContext.window.location = browserContext.location;
vm.runInNewContext(patchedBrowserOcr, browserContext);
const dynamicText = [
  'Girasoles - Helados',
  'Helado la florería $14.000',
  'Gardenias - Topping',
  'Fresas $3.000',
  'Magnolias - Bebidas Calientes',
  'Café americano $4.000',
  'Claveles - Cocteles',
  'Gin tonic maracuyá $18.000',
  'Rosas - Licores',
  'Smirnoff Ice $13.000'
].join('\n');
const dynamicRows = browserContext.window.VantixGCRestaurantBrowserOcr.parseMenuText(dynamicText, { baseConfidence:.97 });
const byName = new Map(dynamicRows.map((row) => [row.subcategory, row]));
assert.equal(byName.get('Helado la florería')?.category, 'Girasoles - Helados');
assert.equal(byName.get('Fresas')?.category, 'Gardenias - Topping');
assert.equal(byName.get('Café americano')?.category, 'Magnolias - Bebidas Calientes');
assert.equal(byName.get('Gin tonic maracuyá')?.category, 'Claveles - Cocteles');
assert.equal(byName.get('Smirnoff Ice')?.category, 'Rosas - Licores');
assert.equal(byName.get('Helado la florería')?.operationalCategory, 'POSTRES', 'operational routing stays internal and separate');
assert.equal(byName.get('Café americano')?.station, 'BARRA', 'station routing remains independent from visible category');

const finalAsset = buildMenuImportBrowserAsset();
assert.match(finalAsset, /VANTIX_MENU_OCR_END_TO_END_10MB_V7/);
assert.match(finalAsset, /VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8/);
assert.match(finalAsset, /VANTIX_BROWSER_OCR_V1/);
assert.match(finalAsset, /VANTIX_BROWSER_OCR_PREPROCESS_V4/);
assert.doesNotMatch(finalAsset, /MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/, 'final served OCR asset must contain no active 5 MiB limit');
assert.doesNotMatch(finalAsset, /Máximo 5 MB|máximo de 5 MB/, 'final served OCR asset must contain no 5 MB rejection text');
assert.doesNotMatch(finalAsset, /commercial\s*=\s*family\s*\|\||category\s*=\s*family\(name\)\s*\|\|\s*clean\(item\.category|category\s*=\s*family\s*\|\|\s*explicitCategory/, 'final asset must keep detected categories authoritative');
assert.ok((finalAsset.match(/const MAX_BYTES = 10 \* 1024 \* 1024;/g) || []).length >= 3, 'main uploader plus browser V1/V4 must all be 10 MiB');
assert.doesNotThrow(() => new vm.Script(finalAsset), 'complete served OCR asset must remain valid JavaScript');

const now = Date.now();
assert.equal(edgeIngress.EDGE_HEARTBEAT_ONLINE_MS, 90_000, 'Edge ingress online window is an explicit 90 seconds');
assert.equal(edgeIngress.heartbeatOnline(new Date(now - 89_000), now), true, 'recent Edge heartbeat must remain cloud-available');
assert.equal(edgeIngress.heartbeatOnline(new Date(now - 91_000), now), false, 'stale Edge heartbeat must force the guarded local fallback');

console.log('RESTAURANT MENU OCR CONTRACT SMOKE OK', JSON.stringify({
  maxBytes: service.MAX_FILE_BYTES,
  uploadMode: 'ADAPTIVE_BINARY_OR_BROWSER',
  categoryMode: 'DETECTED_VISIBLE_HEADING',
  dynamicCategories: [...new Set(dynamicRows.map((row) => row.category))],
  browserFallbackMaxBytes: 10 * 1024 * 1024,
  edgeHeartbeatOnlineMs: edgeIngress.EDGE_HEARTBEAT_ONLINE_MS
}));
