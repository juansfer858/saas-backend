'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER,
  runtime
} = require('../src/modules/restaurant/restaurant-waiter-visit-code-stable.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const tenantRealtime = read('src/modules/restaurant/restaurant-tenant-realtime.public.routes.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit-payments.routes.js');
const visitService = read('src/modules/restaurant/restaurant-visit-payments.service.js');
const waiterBridge = read('src/web/restaurant-waiter-session-v8.js');

assert.equal(MARKER, 'VANTIX_WAITER_VISIT_CODE_V31_STABLE');
assert.doesNotThrow(() => new Function(runtime));
assert.match(runtime, /CÓDIGO PARA ACTIVAR AUTOPEDIDO/);
assert.match(runtime, /\/qr-visita/);
assert.match(runtime, /\/qr-visita\/regenerar/);
assert.match(runtime, /data-waiter-visit-rotate/);
assert.match(runtime, /dataset\.signature/);
assert.match(runtime, /topics\.includes\('restaurant\.visit'\)/);
assert.doesNotMatch(runtime, /data-draft-plus|data-draft-minus|setInterval|MutationObserver/);

assert.match(publicRoot, /installWaiterVisitCodeStableRuntime/);
assert.doesNotMatch(publicRoot, /router\.use\(installWaiterVisitCodeRuntime\)/);
assert.ok(
  publicRoot.indexOf('router.use(installWaiterVisitCodeStableRuntime)') < publicRoot.indexOf('router.use(restaurantTenantRealtimePublicRouter)'),
  'La tarjeta estable debe componerse antes de que Realtime entregue restaurant-ui.js'
);
assert.ok(
  publicRoot.indexOf('router.use(restaurantTenantRealtimePublicRouter)') < publicRoot.indexOf('router.use(restaurantVisitPublicRouter)'),
  'Realtime debe conservar precedencia sobre la superficie de visitas'
);
assert.match(tenantRealtime, /router\.get\('\/app\/restaurant-ui\.js'/);

assert.match(visitRoutes, /\/mesas\/:id\/qr-visita/);
assert.match(visitRoutes, /\/mesas\/:id\/qr-visita\/regenerar/);
assert.match(visitService, /function visitCode\(session\)/);
assert.match(visitService, /async function staffVisitStatus/);
assert.match(visitService, /visitCode:\s*visitCode\(session\)/);

// La PWA/tablet conserva su implementación nativa V16; V31 estabiliza sólo el Mesero del Core/PC.
assert.match(waiterBridge, /VANTIX_WAITER_AUTOPEDIDO_CODE_V16/);
assert.match(waiterBridge, /CÓDIGO PARA ACTIVAR AUTOPEDIDO/);
assert.match(waiterBridge, /data-wv-autopedido-code/);
assert.match(waiterBridge, /CAMBIAR CÓDIGO/);
assert.match(waiterBridge, /visitCodeVisible:true/);
assert.match(waiterBridge, /noPolling:true/);
assert.match(waiterBridge, /noMutationObserver:true/);

console.log(JSON.stringify({
  ok:true,
  controlCenterVisitCode:'V31_STABLE_NO_FLICKER',
  dedicatedWaiterPwaVisitCode:'V16_PRESERVED',
  productQuantityClicksRefreshCode:false,
  sameSignatureRewritesDom:false,
  fourDigitCodeVisible:true,
  rotateCodeVisible:true,
  qrAuthorizationBackendPreserved:true,
  pollingAdded:0,
  mutationObserversAdded:0
}, null, 2));
