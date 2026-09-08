'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ADMIN_PWA_MARKER,
  manifest,
  iconSvg,
  serviceWorkerSource
} = require('../src/modules/platform/core-admin-pwa.public.routes');

assert.equal(ADMIN_PWA_MARKER, 'VANTIXGC_ADMIN_PWA_V1');
assert.equal(manifest.id, '/app/');
assert.equal(manifest.start_url, '/app/dashboard');
assert.equal(manifest.scope, '/app/');
assert.equal(manifest.display, 'standalone');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1);
assert.match(manifest.icons[0].src, /admin-icon\.svg$/);
assert.match(iconSvg, /viewBox="0 0 512 512"/);
assert.match(iconSvg, /#137a53/);

new Function(serviceWorkerSource);
assert.match(serviceWorkerSource, /VANTIXGC_ADMIN_PWA_V1/);
assert.match(serviceWorkerSource, /scope:'\/app\/'/);
assert.match(serviceWorkerSource, /noAuthenticatedApiCache:true/);
assert.match(serviceWorkerSource, /url\.pathname\.startsWith\('\/api\/'\)/);
assert.match(serviceWorkerSource, /event\.respondWith\(fetch\(request\)\)/);
assert.doesNotMatch(serviceWorkerSource, /caches\.|cache\.put|CacheStorage/);

const publicComposition = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicComposition, /core-admin-pwa\.public\.routes/);
assert.match(publicComposition, /router\.use\(coreAdminPwaPublicRouter\)/);
assert.ok(publicComposition.indexOf('router.use(coreAdminPwaPublicRouter)') < publicComposition.indexOf('router.use(legacyRestaurantPublicRouter)'));

const panelRuntime = fs.readFileSync('src/web/panel-integration-extras.js', 'utf8');
new Function(panelRuntime);
assert.match(panelRuntime, /admin-manifest\.webmanifest/);
assert.match(panelRuntime, /navigator\.serviceWorker\.register\('\/app\/admin-sw\.js'/);
assert.match(panelRuntime, /beforeinstallprompt/);
assert.match(panelRuntime, /Instalar app/);
assert.match(panelRuntime, /VantixGCInventoryAdjustmentLibraryV2/);
assert.match(panelRuntime, /remoteSearch: true/);
assert.match(panelRuntime, /showsFullActiveLibrary: true/);
assert.match(panelRuntime, /disablesNonInventoryProducts: true/);
assert.match(panelRuntime, /inventario\/productos\?activo=true&limit=500/);
assert.match(panelRuntime, /q=\$\{encodeURIComponent\(query\.trim\(\)\)\}/);
assert.match(panelRuntime, /Sin control de inventario/);
assert.match(panelRuntime, /Selecciona un producto con control de inventario activo/);
assert.match(panelRuntime, /\/api\/v1\/inventario\/ajustes/);
assert.match(panelRuntime, /installInventoryAdjustmentLibrary\(\)/);

// V70.1: Agregar producto debe vivir en el loader base que ya sirve el Panel.
// No puede depender de que el bundle opcional Realtime/Core/Printing termine de cargar.
assert.match(panelRuntime, /VANTIX_INVENTORY_PRODUCT_CREATE_V70_BASE/);
assert.match(panelRuntime, /installInventoryProductCreatorV70/);
assert.match(panelRuntime, /inventoryAddProductButton/);
assert.match(panelRuntime, /\+ Agregar producto/);
assert.match(panelRuntime, /openInventoryProductFormV70/);
assert.match(panelRuntime, /\/api\/v1\/inventario\/productos/);
assert.match(panelRuntime, /stockActual:0/);
assert.match(panelRuntime, /costoPromedio:0/);
const creatorInstall = panelRuntime.indexOf('installInventoryProductCreatorV70();');
const optionalRuntimeFetch = panelRuntime.indexOf('await Promise.all');
assert.ok(creatorInstall >= 0 && optionalRuntimeFetch >= 0 && creatorInstall < optionalRuntimeFetch,
  'Agregar producto debe instalarse antes de cargar runtimes opcionales');

const productCreator = fs.readFileSync('src/web/inventory-product-create-v70.js', 'utf8');
new Function(productCreator);
assert.match(productCreator, /VANTIX_INVENTORY_PRODUCT_CREATE_V70/);
assert.match(productCreator, /location\.pathname === '\/app\/inventario'/);
assert.match(productCreator, /inventoryAddProductButton/);
assert.match(productCreator, /\+ Agregar producto/);
assert.match(productCreator, /openInventoryProductForm/);
assert.match(productCreator, /\/api\/v1\/inventario\/productos/);
assert.match(productCreator, /stockActual:0/);
assert.match(productCreator, /costoPromedio:0/);
assert.match(productCreator, /Compras o Ajuste de inventario/);

const commercialRoutes = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
assert.match(commercialRoutes, /inventory-product-create-v70\.js/);
assert.match(commercialRoutes, /X-VantixGC-Inventory-Product-Creator/);
assert.match(commercialRoutes, /VANTIX_INVENTORY_PRODUCT_CREATE_V70/);

console.log('CORE ADMIN PWA + INVENTORY ADJUSTMENT + PRODUCT CREATOR SMOKE OK');
console.log(JSON.stringify({
  adminPwaInstallable:true,
  manifestScope:'/app/',
  serviceWorkerNetworkOnly:true,
  authenticatedApiCache:false,
  inventoryProductLibrary:true,
  remoteProductSearch:true,
  nonInventoryProductsVisibleButDisabled:true,
  inventoryAddProductButton:true,
  inventoryCreatorBaseIndependent:true,
  inventoryProductCreateEndpoint:'/api/v1/inventario/productos',
  initialStockAccountingSafe:true
}, null, 2));
