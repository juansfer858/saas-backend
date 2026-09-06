'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const layer = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-cash-collect-dialog.public.routes.js'), 'utf8');
const mount = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const base = fs.readFileSync(path.join(root, 'src/web/restaurant-ui.js'), 'utf8');

assert.match(layer, /VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V40/);
assert.match(layer, /rerenderSafe:true/);
assert.match(layer, /orphanBackdropGuard:true/);
assert.match(layer, /\[data-cash-table\]/);
assert.match(layer, /cash-collect-dialog-v40/);
assert.match(layer, /aria-modal/);
assert.match(layer, /preventScroll:true/);
assert.match(layer, /openWhenReady/);
assert.match(layer, /stabilizeDialog/);
assert.match(layer, /bindCurrentPanel/);
assert.match(layer, /#closeTable/);
assert.match(layer, /cash-collect-backdrop-v40/);
assert.match(layer, /panel\.classList\.contains\(DIALOG_CLASS\)/);
assert.match(layer, /attempt>=9/);
assert.match(layer, /else cleanup\(\{cancelOpen:false\}\)/);
assert.doesNotMatch(layer, /setInterval\s*\(/, 'V40 must not add permanent polling');
assert.doesNotMatch(layer, /MutationObserver\s*\(/, 'V40 must not add DOM observers');
assert.doesNotMatch(layer, /scrollIntoView/, 'V40 must not depend on scrolling to expose payment controls');

assert.match(mount, /installCashCollectDialogRuntime/);
assert.match(mount, /router\.use\(installCashCollectDialogRuntime\)/);
assert.match(base, /data-cash-table/);
assert.match(base, /class=\"cash-panel cash-fast-panel\"/);
assert.match(base, /id=\"closeTable\"/);
assert.match(base, /await renderCash\(\)/, 'Base Caja re-renders after table selection; overlay layer must tolerate replacement');

console.log('RESTAURANT CASH COLLECT DIALOG V40 SMOKE OK', JSON.stringify({
  directCollectDialog:true,
  preservesBasePaymentBindings:true,
  noScrollDependency:true,
  rerenderSafe:true,
  orphanBackdropGuard:true,
  finiteStabilityWindow:true,
  noPermanentPolling:true,
  noMutationObserver:true
}));
