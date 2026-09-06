'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER,
  runtime,
  patchQrOrderTouchLock
} = require('../src/modules/restaurant/restaurant-qr-order-touch-lock.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const qrHtml = read('src/web/restaurant-qr.html');
const qrUi = read('src/web/restaurant-qr-ui.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const moduleSource = read('src/modules/restaurant/restaurant-qr-order-touch-lock.public.routes.js');

assert.equal(MARKER, 'VANTIX_RESTAURANT_QR_ORDER_TOUCH_LOCK_V34');
new Function(runtime);

const patched = patchQrOrderTouchLock(qrUi);
assert.notEqual(patched, qrUi, 'V34 debe modificar el open/close canonico de Mi pedido');
assert.equal(patchQrOrderTouchLock(patched), patched, 'La composición V34 debe ser idempotente');
new Function(patched);

assert.match(qrHtml, /id="orderPanel" class="qrv3-modal"/);
assert.match(qrHtml, /id="orderPanelBody" class="qrv3-sheet-body"/);
assert.match(qrUi, /openPanel\('#orderPanel'\)/);
assert.match(qrUi, /closePanel\('#orderPanel'\)/);

// El bloqueo debe ocurrir dentro del flujo canónico, antes de mostrar/focalizar el modal.
assert.match(patched, /if \(isOrderPanel\) lockOrderPanelTouch\(panel\);\n    panel\.hidden = false/);
assert.match(patched, /focus\(\{ preventScroll:true \}\)/);
assert.match(patched, /document\.body\.style\.position = 'fixed'/);
assert.match(patched, /body\.dataset\.qrOrderTouchLocked = '1'/);
assert.match(patched, /node\.inert = true/);
assert.match(patched, /window\.scrollTo\(0, restoreY\)/);
assert.doesNotMatch(patched, /panel\.querySelector\('button'\)\?\.focus\(\);/);

// Mi pedido posee el único scroll táctil; la hoja y el fondo no desplazan el viewport.
assert.match(runtime, /#orderPanel:not\(\[hidden\]\) \.qrv3-sheet\{[^}]*overflow:hidden!important/);
assert.match(runtime, /#orderPanel:not\(\[hidden\]\) #orderPanelBody\{[^}]*overflow-y:auto!important/);
assert.match(runtime, /#orderPanel:not\(\[hidden\]\) #orderPanelBody\{[^}]*touch-action:pan-y!important/);
assert.match(runtime, /overscroll-behavior:contain!important/);
assert.match(runtime, /-webkit-overflow-scrolling:touch/);
assert.match(runtime, /touchstart/);
assert.match(runtime, /touchmove/);
assert.match(runtime, /atTop&&delta>0/);
assert.match(runtime, /atBottom&&delta<0/);
assert.match(runtime, /passive:false/);
assert.match(runtime, /event\.preventDefault\(\)/);
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
  ownedScroll:'#orderPanelBody',
  lockBeforeVisible:true,
  focusPreventScroll:true,
  backgroundFixed:true,
  backgroundInert:true,
  iosBoundaryBounceBlocked:true,
  scrollPositionRestored:true,
  pollingAdded:0,
  mutationObserversAdded:0
}, null, 2));
