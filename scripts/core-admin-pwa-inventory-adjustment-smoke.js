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

console.log('CORE ADMIN PWA + INVENTORY ADJUSTMENT LIBRARY SMOKE OK');
console.log(JSON.stringify({
  adminPwaInstallable:true,
  manifestScope:'/app/',
  serviceWorkerNetworkOnly:true,
  authenticatedApiCache:false,
  inventoryProductLibrary:true,
  remoteProductSearch:true,
  nonInventoryProductsVisibleButDisabled:true
}, null, 2));
