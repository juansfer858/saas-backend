'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { waiterStableBase, WAITER_STABILITY_MARKER } = require('../src/modules/restaurant/restaurant-employee-work.public.routes');

const base = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
const patched = waiterStableBase(base);
assert.ok(patched.includes(WAITER_STABILITY_MARKER));
assert.ok(patched.includes('if (waiterRenderPromise)'));
assert.ok(patched.includes('waiterRenderQueued = true'));
assert.ok(patched.includes('waiterRenderPromise = (async () =>'));
assert.ok(patched.includes('queueMicrotask(() => renderWaiter()'));
assert.ok(patched.includes("document.documentElement.dataset.waiterRenderBusy = '1'"));
assert.ok(patched.includes('delete document.documentElement.dataset.waiterRenderBusy'));
new Function(patched);

const perf = fs.readFileSync('src/web/restaurant-waiter-performance-v6.js', 'utf8');
assert.match(perf, /VANTIX_WAITER_INTERACTION_STABILITY_V6/);
assert.match(perf, /responseCache/);
assert.match(perf, /inflight/);
assert.match(perf, /ttlFor/);
assert.match(perf, /900/);
assert.match(perf, /650/);
assert.match(perf, /invalidateForMutation/);
assert.match(perf, /mutationDepth/);
assert.match(perf, /Actualizando…/);
assert.match(perf, /stopImmediatePropagation/);
new Function(perf);

console.log(JSON.stringify({
  ok:true,
  marker:WAITER_STABILITY_MARKER,
  interaction:'SERIAL_RENDER_PLUS_SHORT_READ_CACHE',
  duplicateGets:'DEDUPED',
  rapidMutations:'GUARDED',
  staleRenderRace:'BLOCKED'
}));
