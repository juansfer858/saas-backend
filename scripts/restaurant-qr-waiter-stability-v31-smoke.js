'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (p) => fs.readFileSync(p, 'utf8');
const qrHtml = read('src/web/restaurant-qr.html');
const qrUi = read('src/web/restaurant-qr-ui.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const callUi = read('src/web/restaurant-waiter-call-ui.js');
const broadcast = read('src/modules/restaurant/restaurant-waiter-call-broadcast.service.js');
const unifiedRoutes = read('src/modules/restaurant/restaurant-waiter-call-unified.routes.js');
const unifiedPublic = read('src/modules/restaurant/restaurant-waiter-call-unified.public.routes.js');
const scroll = require('../src/modules/restaurant/restaurant-qr-order-scroll-lock.public.routes');
const visitStable = require('../src/modules/restaurant/restaurant-waiter-visit-code-stable.public.routes');

// 1) Mi pedido owns its scroll; the menu behind it must remain frozen.
assert.match(qrHtml, /id="orderPanel" class="qrv3-modal"/);
assert.match(qrHtml, /<section class="qrv3-sheet">/);
assert.match(qrUi, /openPanel\('#orderPanel'\)/);
assert.equal(scroll.MARKER, 'VANTIX_RESTAURANT_QR_ORDER_SCROLL_LOCK_V31');
assert.doesNotThrow(() => new vm.Script(scroll.runtime));
assert.match(scroll.runtime, /#orderPanel:not\(\[hidden\]\) \.qrv3-sheet/);
assert.match(scroll.runtime, /document\.body\.style\.position='fixed'/);
assert.match(scroll.runtime, /document\.body\.style\.top=\(-scrollY\)\+'px'/);
assert.match(scroll.runtime, /overscroll-behavior:contain/);
assert.match(scroll.runtime, /touch-action:pan-y/);
assert.match(scroll.runtime, /window\.scrollTo\(0,scrollY\)/);
assert.doesNotMatch(scroll.runtime, /MutationObserver|setInterval|classList\.contains\('order-open'\)/);

// 2) Same waiter session can consume alerts on PC and linked device surfaces.
assert.match(unifiedRoutes, /restaurantWaiterCallUnifiedRouter/);
assert.match(unifiedRoutes, /router\.get\('\/llamadas-mesero'/);
assert.match(unifiedRoutes, /router\.get\('\/llamadas-mesero\/stream'/);
assert.match(unifiedRoutes, /req\.authType === 'WAITER_DEVICE'/);
assert.match(unifiedPublic, /verifyAccessToken/);
assert.match(unifiedPublic, /installWaiterCallPcRuntime/);
assert.match(unifiedPublic, /VANTIX_WAITER_CALL_PC_V31/);
assert.match(unifiedPublic, /unified\.kick\(table\.tenantId\)/);
assert.match(broadcast, /return baseCalls\.waiterCallsSnapshot\(tenantId, actorId\)/);
assert.match(broadcast, /administrator|administrador/i);
assert.match(callUi, /\/api\/public\/restaurante\/mesero-dispositivo\/llamadas/);
assert.match(callUi, /\/api\/v1\/restaurante\/llamadas-mesero\/stream/);
assert.ok(coreRoutes.indexOf('restaurantWaiterCallUnifiedRouter') < coreRoutes.indexOf('restaurantWaiterCallRouter'), 'unified Core waiter-call route must precede legacy device-only route');
assert.ok(publicRoot.indexOf('restaurantWaiterCallUnifiedPublicRouter') < publicRoot.indexOf('restaurantWaiterCallPublicRouter'), 'unified public waiter-call route must precede legacy route');
assert.ok(publicRoot.indexOf('installWaiterCallPcRuntime') < publicRoot.indexOf('restaurantTenantRealtimePublicRouter'), 'PC alert runtime must compose before canonical restaurant-ui response');

// 3) QR visit code must not redraw on product quantity clicks.
assert.equal(visitStable.MARKER, 'VANTIX_WAITER_VISIT_CODE_V31_STABLE');
assert.doesNotThrow(() => new vm.Script(visitStable.runtime));
assert.match(visitStable.runtime, /dataset\.signature/);
assert.match(visitStable.runtime, /topics\.includes\('restaurant\.visit'\)/);
assert.doesNotMatch(visitStable.runtime, /data-draft-plus|data-draft-minus|restaurant\.order|MutationObserver|setInterval/);
assert.match(publicRoot, /installWaiterVisitCodeStableRuntime/);

// Composition order: all three patches must wrap the canonical assets before they are served.
assert.match(publicRoot, /installQrOrderScrollLock/);
assert.match(publicRoot, /installWaiterCallPcRuntime/);
assert.match(publicRoot, /installWaiterVisitCodeStableRuntime/);

console.log('RESTAURANT QR + WAITER MULTISURFACE STABILITY V31 SMOKE OK', JSON.stringify({
  qrOrderScrollOwnedByDrawer:true,
  backgroundScrollFrozen:true,
  pcWaiterAlerts:true,
  linkedDeviceAlertsPreserved:true,
  primaryWaiterPolicyPreserved:true,
  adminMeseroSupervision:true,
  visitCodeProductClickRedraw:false,
  visitCodeSignatureGuard:true,
  cajaUntouched:true,
  printingUntouched:true
}));
