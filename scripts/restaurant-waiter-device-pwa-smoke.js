'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { waiterRuntimeV11, waiterRuntimeV13, waiterRuntimeV14, waiterPwaV11 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

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
const sessionBridge = read('src/web/restaurant-waiter-session-v8.js');
const pwa = waiterPwaV11(read('src/web/restaurant-waiter-pwa-v7.html'));
const runtimeV11 = waiterRuntimeV11(read('src/web/restaurant-waiter-runtime-v7.js'));
const runtimeV13 = waiterRuntimeV13(read('src/web/restaurant-waiter-runtime-v7.js'));
const runtime = waiterRuntimeV14(read('src/web/restaurant-waiter-runtime-v7.js'));
const flexible = read('src/modules/restaurant/restaurant-waiter-service-flex-v9.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit-payments.routes.js');
const visitService = read('src/modules/restaurant/restaurant-visit-payments.service.js');
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
assert.match(publicRoutes, /waiterRuntimeV13/);
assert.match(publicRoutes, /waiterRuntimeV14/);
assert.match(publicRoutes, /v14-review-hard-gate/);
assert.match(publicRoutes, /v14-review-hard-gate-persistent/);
assert.doesNotMatch(publicRoutes, /waiterReactiveV9Script/);
assert.match(coreRoutes, /restaurantWaiterDeviceRouter/);
assert.match(publicRoot, /restaurantWaiterDevicePublicRouter/);

assert.match(visitRoutes, /\/mesas\/:id\/qr-visita/);
assert.match(visitRoutes, /\/mesas\/:id\/qr-visita\/regenerar/);
assert.match(visitService, /function visitCode\(session\)/);
assert.match(visitService, /async function staffVisitStatus/);
assert.match(visitService, /visitCode:\s*visitCode\(session\)/);

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
assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);
assert.match(pwa, /Dispositivo vinculado · acceso guardado/);
assert.match(pwa, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(pwa, /@media\(max-width:350px\)/);
assert.match(pwa, /overflow-wrap:anywhere/);
assert.match(pwa, /id="wvApp"/);
assert.match(pwa, /id="wvMessage"/);
assert.doesNotMatch(pwa, /restaurant-ui\.js/);
assert.doesNotMatch(pwa, /MutationObserver/);

assert.match(runtimeV11, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtimeV13, /VANTIX_WAITER_ORDER_REVIEW_SYNC_V13/);
assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_SYNC_V13/);
assert.match(runtime, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtime, /VANTIX_WAITER_DEDICATED_RUNTIME_V7/);
assert.match(runtime, /DEDICATED_PARTIAL_DOM_OPTIMISTIC/);
assert.match(runtime, /function applyServiceLocally/);
assert.match(runtime, /const mutationEpoch = \+\+S\.detailsEpoch/);
assert.match(runtime, /data-action="remove-person"/);
assert.match(runtime, /Quitar última persona/);
assert.match(runtime, /flexibleGuestMerge:true/);
assert.match(runtime, /singleStateOwner:true/);
assert.match(runtime, /orderReviewSync:true/);
assert.match(runtime, /hardReviewGate:true/);
assert.match(runtime, /noDirectKitchenSend:true/);
assert.match(runtime, /orderReviewReadySessionId:null/);
assert.match(runtime, /REVISANDO PEDIDO/);
assert.match(runtime, /await flushQtyJobs\(\)/);
assert.match(runtime, /refreshSelectedDetails\(\{ quiet:true, force:true \}\)/);
assert.match(runtime, /vantix:waiter-order-review-ready/);
assert.match(runtime, /data-action="confirm-send-draft"/);
assert.match(runtime, /CONFIRMAR PEDIDO/);
assert.match(runtime, /sendDraft\(reviewSessionId\)/);
assert.match(runtime, /Debes revisar el pedido antes de enviarlo/);
assert.doesNotMatch(runtime, /data-action="send-draft"/);
assert.doesNotMatch(runtime, /if \(action === 'send-draft'\)/);
assert.match(runtime, /qtyDesired:new Map/);
assert.match(runtime, /queueQtySync/);
assert.match(runtime, /detailsEpoch/);
assert.doesNotMatch(runtime, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
assert.doesNotMatch(runtime, /MutationObserver/);
assert.doesNotMatch(runtime, /setInterval/);
new Function(runtime);

assert.match(sessionBridge, /VANTIX_WAITER_ORDER_REVIEW_V12/);
assert.match(sessionBridge, /VANTIX_WAITER_ORDER_REVIEW_SYNC_V13/);
assert.match(sessionBridge, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
assert.match(sessionBridge, /VANTIX_WAITER_TABLET_REVIEW_ENTRY_V15/);
assert.match(sessionBridge, /data-wv-review-entry/);
assert.match(sessionBridge, /REVISAR PEDIDO/);
assert.match(sessionBridge, /ensureReviewEntryButton/);
assert.match(sessionBridge, /toggle\.click\(\)/);
assert.match(sessionBridge, /Pedido por confirmar/);
assert.match(sessionBridge, /CONFIRMAR PEDIDO/);
assert.match(sessionBridge, /Revisa antes de enviar/);
assert.match(sessionBridge, /Nada se envía hasta pulsar/);
assert.match(sessionBridge, /data-action=\"confirm-send-draft\"/);
assert.doesNotMatch(sessionBridge, /data-action=\"send-draft\"/);
assert.match(sessionBridge, /#wvOrderToggle/);
assert.match(sessionBridge, /POR CONFIRMAR/);
assert.match(sessionBridge, /YA ENVIADO/);
assert.match(sessionBridge, /vantix:waiter-order-review-ready/);
assert.match(sessionBridge, /syncedBeforeReview:true/);
assert.match(sessionBridge, /tabletReviewEntry:true/);
assert.match(sessionBridge, /noDirectKitchenSend:true/);

assert.match(sessionBridge, /VANTIX_WAITER_AUTOPEDIDO_CODE_V16/);
assert.match(sessionBridge, /CÓDIGO PARA ACTIVAR AUTOPEDIDO/);
assert.match(sessionBridge, /\/qr-visita/);
assert.match(sessionBridge, /data-wv-autopedido-code/);
assert.match(sessionBridge, /data-wv-autopedido-rotate/);
assert.match(sessionBridge, /CAMBIAR CÓDIGO/);
assert.match(sessionBridge, /visitCodeVisible:true/);
assert.match(sessionBridge, /noPolling:true/);
assert.match(sessionBridge, /noMutationObserver:true/);
assert.doesNotMatch(sessionBridge, /MutationObserver/);
assert.doesNotMatch(sessionBridge, /setInterval/);
assert.doesNotMatch(sessionBridge, /restaurant-ui\.js/);
new Function(sessionBridge);

assert.match(flexible, /VANTIX_WAITER_FLEXIBLE_BILLING_V10/);
assert.match(flexible, /seatNumber:\s*\{ gt: targetGuests \}/);
assert.match(flexible, /data:\s*\{ seatNumber: targetGuests \}/);
assert.match(flexible, /targetMode === 'INDIVIDUAL' \? 1 : null/);
assert.match(flexible, /identity\.updateTableServiceSetup = updateTableServiceSetupFlexible/);

assert.match(sw, /vantixgc-waiter-shell-v16-autopedido-code/);
assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);
assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return/);
assert.match(sw, /request\.method !== 'GET'/);
assert.doesNotMatch(sw, /POST|PUT|PATCH|DELETE/);

console.log(JSON.stringify({
  ok:true,
  product:'VantixGC Mesero PWA',
  version:'V16_AUTOPEDIDO_CODE',
  runtime:'V11_NO_REBOUND_PLUS_V13_SYNC_PLUS_V14_HARD_GATE_PLUS_V15_TABLET_REVIEW_ENTRY_PLUS_V16_AUTOPEDIDO_CODE',
  deviceSession:'persistent-until-revoked',
  billingButtonsDoNotBounceBack:true,
  guestButtonsDoNotBounceBack:true,
  staleResponsesInvalidated:true,
  addPerson:true,
  removePerson:true,
  orderReviewBeforeSend:true,
  orderSynchronizedBeforeReview:true,
  hardReviewGate:true,
  tabletReviewEntry:true,
  autopedidoVisitCodeVisible:true,
  autopedidoVisitCodeRotatable:true,
  directKitchenSendImpossibleFromReviewButton:true,
  confirmOrderButton:true,
  pendingAndSentSeparated:true,
  billingModeFlexibleWithConsumption:true,
  serviceWorkerCache:'vantixgc-waiter-shell-v16-autopedido-code'
}));
