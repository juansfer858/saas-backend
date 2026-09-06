'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MARKER, runtime } = require('../src/modules/restaurant/restaurant-qr-order-touch-lock.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const qrHtml = read('src/web/restaurant-qr.html');
const qrUi = read('src/web/restaurant-qr-ui.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const moduleSource = read('src/modules/restaurant/restaurant-qr-order-touch-lock.public.routes.js');

assert.equal(MARKER, 'VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V33');
new Function(runtime);

assert.match(qrHtml, /id="orderPanel" class="qrv3-modal"/);
assert.match(qrHtml, /id="orderPanelBody" class="qrv3-sheet-body"/);
assert.match(qrHtml, /<section class="qrv3-sheet">/);
assert.match(qrUi, /openPanel\('#orderPanel'\)/);
assert.match(qrUi, /closePanel\('#orderPanel'\)/);

assert.match(runtime, /document\.body\.style\.position='fixed'/);
assert.match(runtime, /document\.body\.dataset\.qrOrderTouchLocked='1'/);
assert.match(runtime, /node\.inert=true/);
assert.match(runtime, /pointer-events:none!important/);
assert.match(runtime, /#orderPanel:not\(\[hidden\]\).*touch-action:none!important/);
assert.match(runtime, /\.qrv3-sheet\{[^}]*touch-action:pan-y!important/);
assert.match(runtime, /overscroll-behavior:contain!important/);
assert.match(runtime, /-webkit-overflow-scrolling:touch/);
assert.match(runtime, /touchmove/);
assert.match(runtime, /passive:false/);
assert.match(runtime, /event\.preventDefault\(\)/);
assert.match(runtime, /window\.scrollTo\(0,scrollY\)/);
assert.doesNotMatch(runtime, /setInterval|MutationObserver/);

assert.match(moduleSource, /req\.path !== '\/app\/restaurant-qr-ui\.js'/);
assert.match(publicRoot, /installQrOrderTouchLock/);
assert.ok(
  publicRoot.indexOf('router.use(installQrOrderTouchLock)') < publicRoot.indexOf('router.use(restaurantPublicRealtimePublisher)'),
  'El touch lock debe envolver el asset QR antes de que las capas posteriores lo entreguen'
);

console.log(JSON.stringify({
  ok:true,
  marker:MARKER,
  modal:'#orderPanel',
  ownedScroll:'.qrv3-sheet',
  backgroundFixed:true,
  backgroundInert:true,
  backgroundPointerEvents:false,
  backdropTouchPrevented:true,
  scrollPositionRestored:true,
  pollingAdded:0,
  mutationObserversAdded:0
}, null, 2));
