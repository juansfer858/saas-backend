'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  WAITER_VISIT_CODE_MARKER,
  waiterVisitCodeRuntime,
  patchWaiterVisitCodeRuntime
} = require('../src/modules/restaurant/restaurant-waiter-visit-code.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const baseUi = read('src/web/restaurant-ui.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const tenantRealtime = read('src/modules/restaurant/restaurant-tenant-realtime.public.routes.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit-payments.routes.js');
const visitService = read('src/modules/restaurant/restaurant-visit-payments.service.js');
const waiterBridge = read('src/web/restaurant-waiter-session-v8.js');

const patched = patchWaiterVisitCodeRuntime(baseUi);
assert.notEqual(patched, baseUi, 'El Centro de control debe recibir la capa del código de visita');
assert.match(patched, new RegExp(WAITER_VISIT_CODE_MARKER));
assert.match(patched, /CÓDIGO PARA ACTIVAR AUTOPEDIDO/);
assert.match(patched, /\/qr-visita/);
assert.match(patched, /\/qr-visita\/regenerar/);
assert.match(patched, /Dile estos 4 números/);
assert.match(patched, /data-waiter-visit-rotate/);
assert.equal(patchWaiterVisitCodeRuntime(patched), patched, 'La composición debe ser idempotente');
new Function(patched);

assert.match(waiterVisitCodeRuntime, /eventDriven:true/);
assert.match(waiterVisitCodeRuntime, /noPolling:true/);
assert.match(waiterVisitCodeRuntime, /observerFree:true/);
assert.match(waiterVisitCodeRuntime, /productClicksIgnored:true/);
assert.match(waiterVisitCodeRuntime, /stableDom:true/);
assert.match(waiterVisitCodeRuntime, /function signature\(status\)/);
assert.match(waiterVisitCodeRuntime, /card\.dataset\.signature===nextSignature/);
assert.doesNotMatch(waiterVisitCodeRuntime, /\[data-draft-plus\]|\[data-draft-minus\]/, 'Los +/− de productos no deben refrescar la tarjeta del código');
assert.doesNotMatch(waiterVisitCodeRuntime, /card\.dataset\.loaded='0'/, 'Un refresh no debe ocultar el código existente mientras consulta');
assert.doesNotMatch(waiterVisitCodeRuntime, /setInterval|MutationObserver/);

assert.match(publicRoot, /installWaiterVisitCodeRuntime/);
assert.ok(
  publicRoot.indexOf('router.use(installWaiterVisitCodeRuntime)') < publicRoot.indexOf('router.use(restaurantTenantRealtimePublicRouter)'),
  'La tarjeta debe componerse antes de que Realtime V23 entregue restaurant-ui.js'
);
assert.ok(
  publicRoot.indexOf('router.use(restaurantTenantRealtimePublicRouter)') < publicRoot.indexOf('router.use(restaurantVisitPublicRouter)'),
  'La precedencia del complemento de visitas debe conservarse'
);
assert.match(tenantRealtime, /router\.get\('\/app\/restaurant-ui\.js'/);

assert.match(visitRoutes, /\/mesas\/:id\/qr-visita/);
assert.match(visitRoutes, /\/mesas\/:id\/qr-visita\/regenerar/);
assert.match(visitService, /function visitCode\(session\)/);
assert.match(visitService, /async function staffVisitStatus/);
assert.match(visitService, /visitCode:\s*visitCode\(session\)/);

// La PWA/tablet conserva su implementación nativa V16; esta corrección no la reemplaza.
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
  productClicksRefreshCode:false,
  stableDomWhenStatusUnchanged:true,
  fourDigitCodeVisible:true,
  rotateCodeVisible:true,
  qrAuthorizationBackendPreserved:true,
  pollingAdded:0,
  mutationObserversAdded:0
}, null, 2));
