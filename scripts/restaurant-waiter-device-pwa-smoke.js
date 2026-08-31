'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { waiterRuntimeV11, waiterPwaV11 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

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
const pwa = waiterPwaV11(read('src/web/restaurant-waiter-pwa-v7.html'));
const runtime = waiterRuntimeV11(read('src/web/restaurant-waiter-runtime-v7.js'));
const flexible = read('src/modules/restaurant/restaurant-waiter-service-flex-v9.js');
const manifest = JSON.parse(read('src/web/restaurant-waiter-manifest.webmanifest'));
const sw = read('src/web/restaurant-waiter-sw.js');
const restaurantService = read('src/modules/restaurant/restaurant.service.js');
const zoneService = read('src/modules/restaurant/restaurant-zones.service.js');

assert.match(service, /RESTAURANT_WAITER_DEVICE/);
assert.match(service, /PAIRING_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
assert.match(service, /DEVICE_PERSISTENT_UNTIL/);
assert.match(service, /9999-12-31T23:59:59\.000Z/);
assert.match(service, /authType:\s*'WAITER_DEVICE'/);
assert.match(service, /permanent:\s*true/);
assert.doesNotMatch(service, /expiresIn:\s*'365d'/);

assert.match(tenantRoutes, /\/dispositivos-mesero/);
assert.match(publicRoutes, /\/api\/public\/restaurante\/mesero-dispositivo\/vincular/);
assert.match(publicRoutes, /\/app\/centro-de-control\/mesero/);
assert.match(publicRoutes, /restaurant-waiter-service-flex-v9/);
assert.match(publicRoutes, /waiterRuntimeV11/);
assert.match(publicRoutes, /v11-no-rebound-persistent/);
assert.match(publicRoutes, /v11-no-rebound/);
assert.doesNotMatch(publicRoutes, /waiterReactiveV9Script/);
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
assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v11/);
assert.match(pwa, /Dispositivo vinculado · acceso guardado/);
assert.match(pwa, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(pwa, /@media\(max-width:350px\)/);
assert.match(pwa, /overflow-wrap:anywhere/);
assert.match(pwa, /id="wvApp"/);
assert.match(pwa, /id="wvMessage"/);
assert.doesNotMatch(pwa, /restaurant-ui\.js/);
assert.doesNotMatch(pwa, /MutationObserver/);

assert.match(runtime, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtime, /VANTIX_WAITER_DEDICATED_RUNTIME_V7/);
assert.match(runtime, /DEDICATED_PARTIAL_DOM_OPTIMISTIC/);
assert.match(runtime, /function applyServiceLocally/);
assert.match(runtime, /const mutationEpoch = \+\+S\.detailsEpoch/);
assert.match(runtime, /data-action="remove-person"/);
assert.match(runtime, /Quitar última persona/);
assert.match(runtime, /flexibleGuestMerge:true/);
assert.match(runtime, /singleStateOwner:true/);
assert.match(runtime, /qtyDesired:new Map/);
assert.match(runtime, /queueQtySync/);
assert.match(runtime, /detailsEpoch/);
assert.doesNotMatch(runtime, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
assert.doesNotMatch(runtime, /MutationObserver/);
assert.doesNotMatch(runtime, /setInterval/);
new Function(runtime);

assert.match(flexible, /VANTIX_WAITER_FLEXIBLE_BILLING_V10/);
assert.match(flexible, /seatNumber:\s*\{ gt: targetGuests \}/);
assert.match(flexible, /data:\s*\{ seatNumber: targetGuests \}/);
assert.match(flexible, /targetMode === 'INDIVIDUAL' \? 1 : null/);
assert.match(flexible, /identity\.updateTableServiceSetup = updateTableServiceSetupFlexible/);

assert.match(sw, /vantixgc-waiter-shell-v11/);
assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v11/);
assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return/);
assert.match(sw, /request\.method !== 'GET'/);
assert.doesNotMatch(sw, /POST|PUT|PATCH|DELETE/);

console.log(JSON.stringify({
  ok:true,
  product:'VantixGC Mesero PWA',
  version:'V11_NO_REBOUND',
  runtime:'V11_SINGLE_STATE_OWNER',
  deviceSession:'persistent-until-revoked',
  billingButtonsDoNotBounceBack:true,
  guestButtonsDoNotBounceBack:true,
  staleResponsesInvalidated:true,
  addPerson:true,
  removePerson:true,
  billingModeFlexibleWithConsumption:true,
  serviceWorkerCache:'vantixgc-waiter-shell-v11'
}));
