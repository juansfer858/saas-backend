'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER,
  patchQrTrackingTouchLock
} = require('../src/modules/restaurant/restaurant-qr-tracking-touch-lock.public.routes');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const tracking = read('src/web/restaurant-qr-tracking-ui.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');

assert.equal(MARKER, 'VANTIX_QR_TRACKING_TOUCH_LOCK_V35');
const patched = patchQrTrackingTouchLock(tracking);
assert.notEqual(patched, tracking);
assert.equal(patchQrTrackingTouchLock(patched), patched);
new Function(patched);

assert.match(patched, /VANTIX_QR_TRACKING_TOUCH_LOCK_V35/);
assert.match(patched, /function lockTrackingTouch\(/);
assert.match(patched, /function unlockTrackingTouch\(/);
assert.match(patched, /document\.body\.style\.position = 'fixed'/);
assert.match(patched, /document\.body\.style\.top = `-\$\{VANTIX_QR_TRACKING_TOUCH_LOCK_V35\.scrollY\}px`/);
assert.match(patched, /document\.documentElement\.style\.overflow = 'hidden'/);
assert.match(patched, /node\.inert = true/);
assert.match(patched, /lockTrackingTouch\(panel\);\n    panel\.hidden = false/);
assert.match(patched, /focus\(\{ preventScroll:true \}\)/);
assert.match(patched, /#restaurantOrderTrackingPanel:not\(\[hidden\]\) #restaurantOrderTrackingBody\{[^}]*overflow-y:auto/);
assert.match(patched, /#restaurantOrderTrackingPanel:not\(\[hidden\]\) #restaurantOrderTrackingBody\{[^}]*touch-action:pan-y/);
assert.match(patched, /overscroll-behavior:contain/);
assert.match(patched, /-webkit-overflow-scrolling:touch/);
assert.match(patched, /trackingTouchStart/);
assert.match(patched, /trackingTouchMove/);
assert.match(patched, /atTop && delta > 0/);
assert.match(patched, /atBottom && delta < 0/);
assert.match(patched, /event\.preventDefault\(\)/);
assert.match(patched, /window\.scrollTo\(0, restoreY\)/);
assert.doesNotMatch(patched, /MutationObserver/);
assert.match(publicRoot, /installQrTrackingTouchLock/);

console.log(JSON.stringify({
  ok:true,
  marker:MARKER,
  panel:'#restaurantOrderTrackingPanel',
  ownedScroll:'#restaurantOrderTrackingBody',
  backgroundFrozen:true,
  iosBounceBlocked:true,
  restoreScroll:true
}, null, 2));
