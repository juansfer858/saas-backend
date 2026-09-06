'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const layer = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-cash-collect-dialog.public.routes.js'), 'utf8');
const mount = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const base = fs.readFileSync(path.join(root, 'src/web/restaurant-ui.js'), 'utf8');

assert.match(layer, /VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V39/);
assert.match(layer, /\[data-cash-table\]/);
assert.match(layer, /cash-fast-panel\.cash-collect-dialog-v39/);
assert.match(layer, /aria-modal/);
assert.match(layer, /preventScroll:true/);
assert.match(layer, /openWhenReady/);
assert.match(layer, /#closeTable/);
assert.match(layer, /cash-collect-backdrop-v39/);
assert.doesNotMatch(layer, /setInterval\s*\(/, 'V39 must not add polling');
assert.doesNotMatch(layer, /MutationObserver\s*\(/, 'V39 must not add DOM observers');
assert.doesNotMatch(layer, /scrollIntoView/, 'V39 must not depend on scrolling to expose payment controls');

assert.match(mount, /installCashCollectDialogRuntime/);
assert.match(mount, /router\.use\(installCashCollectDialogRuntime\)/);
assert.match(base, /data-cash-table/);
assert.match(base, /class=\"cash-panel cash-fast-panel\"/);
assert.match(base, /id=\"closeTable\"/);

console.log('RESTAURANT CASH COLLECT DIALOG V39 SMOKE OK', JSON.stringify({
  directCollectDialog:true,
  preservesBasePaymentBindings:true,
  noScrollDependency:true,
  noPolling:true,
  noMutationObserver:true
}));
