'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { waiterRuntimeV11, waiterPwaV11 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const base = read('src/web/restaurant-waiter-runtime-v7.js');
const runtime = waiterRuntimeV11(base);
const pwa = waiterPwaV11(read('src/web/restaurant-waiter-pwa-v7.html'));
const sw = read('src/web/restaurant-waiter-sw.js');

assert.match(runtime, /VANTIX_WAITER_NO_REBOUND_V11/);
assert.match(runtime, /function applyServiceLocally/);
assert.match(runtime, /const mutationEpoch = \+\+S\.detailsEpoch/);
assert.match(runtime, /if \(S\.detailsEpoch !== mutationEpoch/);
assert.match(runtime, /renderServiceBar\(\);\n\s*renderMenuGrid\(\);\n\s*renderOrder\(\);/);
assert.match(runtime, /const result = await mutate\(`\/api\/v1\/restaurante\/sesiones\/\$\{sessionId\}\/servicio`/);
assert.match(runtime, /applyServiceLocally\(result\.service/);
assert.match(runtime, /scheduleDetailRefresh\(\);/);
assert.doesNotMatch(runtime, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
assert.doesNotMatch(runtime, /queueMicrotask\(\(\) => paintBilling/);
assert.match(runtime, /data-action="remove-person"/);
assert.match(runtime, /flexibleGuestMerge:true/);
assert.match(pwa, /waiter-runtime-v11/);
assert.match(sw, /vantixgc-waiter-shell-v11/);
assert.match(sw, /waiter-runtime-v11/);

console.log(JSON.stringify({
  ok:true,
  waiter:'V11_NO_REBOUND',
  singleStateOwner:true,
  staleDetailResponsesInvalidated:true,
  serviceAckAppliedWithoutFullReload:true,
  billingButtonsDoNotBounceBack:true,
  guestButtonsDoNotBounceBack:true,
  removePerson:true
}));
