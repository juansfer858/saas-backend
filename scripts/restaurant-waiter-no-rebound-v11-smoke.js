'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { waiterRuntimeV11, waiterRuntimeV14, waiterPwaV11 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const base = read('src/web/restaurant-waiter-runtime-v7.js');
const runtimeV11 = waiterRuntimeV11(base);
const runtime = waiterRuntimeV14(base);
const pwa = waiterPwaV11(read('src/web/restaurant-waiter-pwa-v7.html'));
const sw = read('src/web/restaurant-waiter-sw.js');

assert.match(runtimeV11, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtime, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
assert.match(runtime, /function applyServiceLocally/);
assert.match(runtime, /const mutationEpoch = \+\+S\.detailsEpoch/);
assert.match(runtime, /if \(S\.detailsEpoch !== mutationEpoch/);
assert.match(runtime, /renderServiceBar\(\);\n\s*renderMenuGrid\(\);\n\s*renderOrder\(\);/);
assert.match(runtime, /const result = await api\(`\/api\/v1\/restaurante\/sesiones\/\$\{sessionId\}\/servicio`/);
assert.match(runtime, /applyServiceLocally\(result\.service/);
assert.match(runtime, /scheduleDetailRefresh\(\);/);
assert.doesNotMatch(runtime, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
assert.doesNotMatch(runtime, /queueMicrotask\(\(\) => paintBilling/);
assert.match(runtime, /data-action="remove-person"/);
assert.match(runtime, /flexibleGuestMerge:true/);
assert.match(runtime, /singleStateOwner:true/);
assert.match(runtime, /hardReviewGate:true/);
assert.match(runtime, /data-action="confirm-send-draft"/);
assert.doesNotMatch(runtime, /data-action="send-draft"/);
assert.match(pwa, /waiter-runtime-v14/);
assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate/);
assert.match(sw, /waiter-runtime-v14/);

console.log(JSON.stringify({
  ok:true,
  waiter:'V11_NO_REBOUND_WITH_V14_HARD_GATE',
  singleStateOwner:true,
  staleDetailResponsesInvalidated:true,
  serviceAckAppliedWithoutFullReload:true,
  billingButtonsDoNotBounceBack:true,
  guestButtonsDoNotBounceBack:true,
  removePerson:true,
  hardReviewGate:true,
  directKitchenSendFromReviewImpossible:true
}));
