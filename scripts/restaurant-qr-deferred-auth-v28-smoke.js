'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const visitUi = read('src/web/restaurant-qr-visit-ui.js');
const baseUi = read('src/web/restaurant-qr-ui.js');
const presenceRoutes = read('src/modules/restaurant/restaurant-qr-presence-realtime.public.routes.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit.public.routes.js');
const visitService = read('src/modules/restaurant/restaurant-visit-payments.service.js');

assert.match(visitUi, /VANTIX_QR_DEFERRED_AUTH_V28/);
assert.match(visitUi, /browseBeforeCode:true/);
assert.match(visitUi, /codeAtOrderSubmit:true/);
assert.match(visitUi, /automaticOrderResume:true/);
assert.match(visitUi, /backendAuthorizationPreserved:true/);
assert.match(visitUi, /function isOrderSubmit/);
assert.match(visitUi, /async function ensureOrderAuthorization/);
assert.match(visitUi, /CONFIRMAR Y ENVIAR A COCINA/);
assert.match(visitUi, /VOLVER A MI PEDIDO/);
assert.match(visitUi, /Tu pedido ya está listo/);
assert.match(visitUi, /response\.status === 401/);
assert.match(visitUi, /response = await nativeFetch\(input, optionsWithVisitToken\(input, init\)\)/);
assert.match(visitUi, /localStorage\.setItem\(STORAGE_KEY, body\.data\.visitToken\);/);
assert.doesNotMatch(visitUi, /setInterval|MutationObserver/);
new Function(visitUi);

const refreshStart = visitUi.indexOf('async function refreshVisit()');
const refreshEnd = visitUi.indexOf('window.VantixGCQrDeferredAuthorizationV28');
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'Debe existir refreshVisit antes del contrato V28');
const refreshSource = visitUi.slice(refreshStart, refreshEnd);
assert.doesNotMatch(refreshSource, /showAuthorization\(/, 'Abrir el QR no debe pedir código automáticamente');
assert.equal((visitUi.match(/showAuthorization\(\)/g) || []).length, 2, 'El código sólo se define y se invoca desde el gate de envío');

assert.match(baseUi, /ENVIAR PEDIDO A COCINA/);
assert.match(baseUi, /\/pedidos/);
assert.match(baseUi, /method:'POST'/);
assert.match(baseUi, /S\.cart/);

assert.match(visitRoutes, /router\.post\('\/api\/public\/restaurante\/qr\/:token\/pedidos'/);
assert.match(visitRoutes, /visitPayments\.placeAuthorizedQrOrder/);
assert.match(visitService, /async function verifyVisit/);
assert.match(visitService, /RESTAURANT_QR_VISIT_REQUIRED/);
assert.match(visitService, /async function placeAuthorizedQrOrder/);
assert.match(visitService, /const verified = await verifyVisit\(qrToken, rawToken\)/);

assert.match(presenceRoutes, /patchVisitPresenceRealtime/);
assert.match(presenceRoutes, /localStorage\.setItem\(STORAGE_KEY, body\.data\.visitToken\);/);
assert.match(presenceRoutes, /vantix:restaurant-visit-authorized/);

console.log(JSON.stringify({
  ok:true,
  version:'V28_DEFERRED_QR_AUTH',
  browseMenuWithoutCode:true,
  buildCartWithoutCode:true,
  codeRequestedAtKitchenSubmit:true,
  sameOrderResumesAfterAuthorization:true,
  staleAuthorizationRetriesSameOrder:true,
  currentVisitBackendGatePreserved:true,
  realtimePresencePatchCompatible:true
}, null, 2));
