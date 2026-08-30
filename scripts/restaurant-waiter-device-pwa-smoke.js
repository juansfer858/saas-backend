'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const service = read('src/modules/restaurant/restaurant-waiter-device.service.js');
const tenantRoutes = read('src/modules/restaurant/restaurant-waiter-device.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant-waiter-device.public.routes.js');
const auth = read('src/middleware/auth-middleware.js');
const jwt = read('src/utils/jwt.js');
const coreRoutes = read('src/routes/core.routes.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const theme = read('src/web/restaurant-theme.js');
const admin = read('src/web/restaurant-waiter-device-admin.js');
const pair = read('src/web/restaurant-waiter-pair.html');
const pwa = read('src/web/restaurant-waiter-pwa-v7.html');
const runtime = read('src/web/restaurant-waiter-runtime-v7.js');
const manifest = JSON.parse(read('src/web/restaurant-waiter-manifest.webmanifest'));
const sw = read('src/web/restaurant-waiter-sw.js');
const restaurantService = read('src/modules/restaurant/restaurant.service.js');
const zoneService = read('src/modules/restaurant/restaurant-zones.service.js');

assert.match(service, /RESTAURANT_WAITER_DEVICE/);
assert.match(service, /PAIRING_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
assert.match(service, /updateMany\([\s\S]*currentStatus:\s*'PAIRING'/, 'el claim debe ser atómico y de un solo uso');
assert.match(service, /tokenHash:\s*hashToken\(consumeNonce\)/, 'el token de emparejamiento debe invalidarse tras usarlo');
assert.match(service, /authType:\s*'WAITER_DEVICE'/);
assert.match(service, /expiresIn:\s*'365d'/);
assert.match(service, /rol:\s*'MESERO'/, 'sólo un usuario MESERO puede recibir un dispositivo');

assert.match(tenantRoutes, /\/dispositivos-mesero/);
assert.match(tenantRoutes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(publicRoutes, /\/api\/public\/restaurante\/mesero-dispositivo\/vincular/);
assert.match(publicRoutes, /\/app\/centro-de-control\/conectar/);
assert.match(publicRoutes, /\/app\/centro-de-control\/mesero/);
assert.match(publicRoutes, /\/app\/restaurant-waiter-runtime-v7\.js/);
assert.match(publicRoutes, /restaurant-waiter-pwa-v7\.html/);
assert.match(publicRoutes, /X-VantixGC-Waiter-PWA', 'v7-dedicated-partial-dom/);
assert.match(publicRoutes, /X-VantixGC-Waiter-Runtime', 'v7-dedicated/);
assert.doesNotMatch(publicRoutes, /waiterStableBase\(base\)/, 'la PWA V7 no debe construir el panel desde restaurant-ui.js');
assert.match(coreRoutes, /restaurantWaiterDeviceRouter/);
assert.match(publicRoot, /restaurantWaiterDevicePublicRouter/);

assert.match(jwt, /deviceId\s*=\s*null/);
assert.match(jwt, /authType\s*=\s*null/);
assert.match(auth, /payload\.authType\s*===\s*'WAITER_DEVICE'/);
assert.match(auth, /assertActiveDevice/);
assert.match(auth, /user\.rol\s*!==\s*'MESERO'/);

assert.match(theme, /restaurant-waiter-device-admin\.js/);
assert.match(admin, /Conectar tablet o celular/);
assert.match(admin, /\/api\/v1\/restaurante\/dispositivos-mesero\/vinculo/);
assert.match(admin, /Desautorizar/);
assert.match(admin, /rol\s*===\s*'MESERO'/);

assert.match(restaurantService, /applyWaiterTableVisibility/);
assert.match(restaurantService, /assignedWaiterId:\s*null/);
assert.match(zoneService, /assignedWaiterId:\s*null/);

assert.equal(manifest.name, 'VantixGC Mesero');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/app/centro-de-control/mesero?view=mesero&pwa=1');
assert.equal(manifest.scope, '/app/centro-de-control');
assert.ok(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '192x192'));
assert.ok(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '512x512'));

assert.match(pair, /Vincular este dispositivo/);
assert.match(pair, /localStorage\.setItem\(SESSION_KEY/);

assert.match(pwa, /<title>VantixGC Mesero<\/title>/);
assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v7/);
assert.match(pwa, /id="wvApp"/);
assert.match(pwa, /id="wvMessage"/);
assert.match(pwa, /id="wvSync"/);
assert.match(pwa, /100dvh/);
assert.doesNotMatch(pwa, /restaurant-ui\.js/);
assert.doesNotMatch(pwa, /restaurant-waiter-performance-v6/);
assert.doesNotMatch(pwa, /MutationObserver/);
assert.doesNotMatch(pwa, /restaurant-control-center\.js/);

assert.match(runtime, /VANTIX_WAITER_DEDICATED_RUNTIME_V7/);
assert.match(runtime, /DEDICATED_PARTIAL_DOM_OPTIMISTIC/);
assert.match(runtime, /qtyDesired:new Map/);
assert.match(runtime, /qtyJobs:new Map/);
assert.match(runtime, /queueQtySync/);
assert.match(runtime, /flushQtyJobs/);
assert.match(runtime, /detailsEpoch/);
assert.match(runtime, /IDLE_BEFORE_POLL_MS/);
assert.match(runtime, /MENU_PAGE\s*=\s*40/);
assert.match(runtime, /id="wvTables"/);
assert.match(runtime, /id="wvBody"/);
assert.match(runtime, /id="wvOrder"/);
assert.match(runtime, /renderMenuGrid/);
assert.match(runtime, /renderOrder/);
assert.match(runtime, /renderHistory/);
assert.match(runtime, /setTimeout\(pollTick/);
assert.doesNotMatch(runtime, /MutationObserver/);
assert.doesNotMatch(runtime, /setInterval/);
assert.doesNotMatch(runtime, /restaurant-ui\.js/);
assert.doesNotMatch(runtime, /#view/);
new Function(runtime);

assert.match(sw, /vantixgc-waiter-shell-v7/);
assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v7/);
assert.doesNotMatch(sw, /restaurant-waiter-ui-v6/);
assert.doesNotMatch(sw, /restaurant-waiter-performance-v6/);
assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return/);
assert.match(sw, /request\.method !== 'GET'/);
assert.doesNotMatch(sw, /POST|PUT|PATCH|DELETE/, 'service worker no debe reintentar ni cachear mutaciones');

console.log(JSON.stringify({
  ok:true,
  product:'VantixGC Mesero PWA',
  runtime:'V7_DEDICATED',
  deviceSession:'server-revocable',
  sharedTablePool:true,
  fullRootRerender:false,
  genericRestaurantUiLoaded:false,
  optimisticQuantity:true,
  coalescedQuantityWrites:true,
  eventDelegation:true,
  idlePolling:true,
  pollingOverlap:false,
  menuDomLimit:40,
  serviceWorkerCache:'vantixgc-waiter-shell-v7',
  businessMutationReplay:false
}));
