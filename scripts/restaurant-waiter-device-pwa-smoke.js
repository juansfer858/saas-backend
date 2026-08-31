'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

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
const reactive = read('src/web/restaurant-waiter-reactive-v9.js');
const flexible = read('src/modules/restaurant/restaurant-waiter-service-flex-v9.js');
const manifest = JSON.parse(read('src/web/restaurant-waiter-manifest.webmanifest'));
const sw = read('src/web/restaurant-waiter-sw.js');
const restaurantService = read('src/modules/restaurant/restaurant.service.js');
const zoneService = read('src/modules/restaurant/restaurant-zones.service.js');

assert.match(service, /RESTAURANT_WAITER_DEVICE/);
assert.match(service, /PAIRING_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
assert.match(service, /DEVICE_PERSISTENT_UNTIL/);
assert.match(service, /9999-12-31T23:59:59\.000Z/);
assert.match(service, /updateMany\([\s\S]*currentStatus:\s*'PAIRING'/);
assert.match(service, /tokenHash:\s*hashToken\(consumeNonce\)/);
assert.match(service, /authType:\s*'WAITER_DEVICE'/);
assert.match(service, /permanent:\s*true/);
assert.doesNotMatch(service, /expiresIn:\s*'365d'/);
assert.match(service, /rol:\s*'MESERO'/);

assert.match(tenantRoutes, /\/dispositivos-mesero/);
assert.match(tenantRoutes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(publicRoutes, /\/api\/public\/restaurante\/mesero-dispositivo\/vincular/);
assert.match(publicRoutes, /\/app\/centro-de-control\/mesero/);
assert.match(publicRoutes, /restaurant-waiter-reactive-v9\.js/);
assert.match(publicRoutes, /restaurant-waiter-service-flex-v9/);
assert.match(publicRoutes, /X-VantixGC-Waiter-PWA', 'v9-reactive-persistent/);
assert.match(publicRoutes, /X-VantixGC-Waiter-Runtime', 'v9-reactive-adaptive/);
assert.match(coreRoutes, /restaurantWaiterDeviceRouter/);
assert.match(publicRoot, /restaurantWaiterDevicePublicRouter/);

assert.match(jwt, /permanent\s*=\s*false/);
assert.match(jwt, /if \(!permanent\) options\.expiresIn/);
assert.match(auth, /payload\.authType\s*===\s*'WAITER_DEVICE'/);
assert.match(auth, /assertActiveDevice/);

assert.match(theme, /restaurant-waiter-device-admin\.js/);
assert.match(admin, /Conectar tablet o celular/);
assert.match(admin, /Desautorizar/);
assert.match(restaurantService, /applyWaiterTableVisibility/);
assert.match(restaurantService, /assignedWaiterId:\s*null/);
assert.match(zoneService, /assignedWaiterId:\s*null/);

assert.equal(manifest.name, 'VantixGC Mesero');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/app/centro-de-control/mesero?view=mesero&pwa=1');

assert.match(pair, /Vincular este dispositivo/);
assert.match(pair, /localStorage\.setItem\(SESSION_KEY/);

assert.match(pwa, /<title>VantixGC Mesero<\/title>/);
assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v8/);
assert.match(pwa, /Dispositivo vinculado · acceso guardado/);
assert.match(pwa, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(pwa, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(pwa, /@media\(max-width:350px\)/);
assert.match(pwa, /overflow-wrap:anywhere/);
assert.match(pwa, /id="wvApp"/);
assert.match(pwa, /id="wvMessage"/);
assert.doesNotMatch(pwa, /restaurant-ui\.js/);
assert.doesNotMatch(pwa, /MutationObserver/);

assert.match(runtime, /VANTIX_WAITER_DEDICATED_RUNTIME_V7/);
assert.match(runtime, /DEDICATED_PARTIAL_DOM_OPTIMISTIC/);
assert.match(runtime, /qtyDesired:new Map/);
assert.match(runtime, /queueQtySync/);
assert.match(runtime, /detailsEpoch/);
assert.doesNotMatch(runtime, /MutationObserver/);
assert.doesNotMatch(runtime, /setInterval/);
new Function(runtime);

assert.match(reactive, /VANTIX_WAITER_REACTIVE_SERVICE_V9/);
assert.match(reactive, /document\.addEventListener\('click',[\s\S]*true\)/);
assert.match(reactive, /paintBilling\(desired\)/);
assert.match(reactive, /pointerEvents = locked/);
assert.match(reactive, /aria-pressed/);
new Function(reactive);

assert.match(flexible, /VANTIX_WAITER_FLEXIBLE_BILLING_V9/);
assert.match(flexible, /targetMode === 'INDIVIDUAL' \? 1 : null/);
assert.match(flexible, /identity\.updateTableServiceSetup = updateTableServiceSetupFlexible/);

assert.match(sw, /vantixgc-waiter-shell-v9/);
assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v8/);
assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return/);
assert.match(sw, /request\.method !== 'GET'/);
assert.doesNotMatch(sw, /POST|PUT|PATCH|DELETE/);

console.log(JSON.stringify({
  ok:true,
  product:'VantixGC Mesero PWA',
  version:'V9_REACTIVE_PERSISTENT',
  runtime:'V7_DEDICATED_PLUS_V9_REACTIVE',
  deviceSession:'persistent-until-revoked',
  visualBillingReactionImmediate:true,
  serviceControlsSerialized:true,
  billingModeFlexibleWithConsumption:true,
  adaptiveButtons:true,
  serviceWorkerCache:'vantixgc-waiter-shell-v9'
}));
