'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SPLIT_STATIC_MARKER,
  SPLIT_BRIDGE_MARKER,
  patchStaticSplitEntry
} = require('../src/modules/restaurant/restaurant-cash-collect-dialog.public.routes');

const root = path.join(__dirname, '..');
const layer = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-cash-collect-dialog.public.routes.js'), 'utf8');
const mount = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const base = fs.readFileSync(path.join(root, 'src/web/restaurant-ui.js'), 'utf8');
const payments = fs.readFileSync(path.join(root, 'src/web/restaurant-visit-payments-ui.js'), 'utf8');

assert.match(layer, /VANTIX_RESTAURANT_CASH_COLLECT_DIALOG_V40/);
assert.match(layer, /version:'40\.1\.0'/);
assert.match(layer, /rerenderSafe:true/);
assert.match(layer, /orphanBackdropGuard:true/);
assert.match(layer, /staticSplitEntryBridge:true/);
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
assert.doesNotMatch(layer, /createElement\(['"]script['"]\)/, 'V76.2 must not dynamically inject scripts');
assert.doesNotMatch(layer, /restaurant-visit-payments-ui\.js\?v=/, 'V76.2 must not reload the payment runtime');

assert.match(mount, /installCashCollectDialogRuntime/);
assert.match(mount, /router\.use\(installCashCollectDialogRuntime\)/);
assert.match(base, /data-cash-table/);
assert.match(base, /class=\"cash-panel cash-fast-panel\"/);
assert.match(base, /id=\"closeTable\"/);
assert.match(base, /await renderCash\(\)/, 'Base Caja re-renders after table selection; overlay layer must tolerate replacement');

// V76.2: compose the real Caja source exactly as production does, then prove
// that the split entry is literally part of the Cobrar Mesa template. It no
// longer relies on a client-side observer to create the button.
const composed = patchStaticSplitEntry(`${base}\n;${payments}`);
new Function(composed);
assert.match(composed, new RegExp(SPLIT_STATIC_MARKER));
assert.match(composed, new RegExp(SPLIT_BRIDGE_MARKER));
assert.match(composed, /id="restaurantSplitEntry"[^>]+data-vantix-split-static="VANTIX_RESTAURANT_SPLIT_STATIC_ENTRY_V76_2"[^>]+data-table-id="\$\{selected\.id\}"/);
assert.match(composed, /window\.VantixRestaurantSplitPayments=Object\.freeze\(\{marker:'VANTIX_RESTAURANT_SPLIT_BRIDGE_V76_2',open:openSplitDialog\}\)/);
assert.ok(
  composed.indexOf('VANTIX_RESTAURANT_SPLIT_STATIC_ENTRY_V76_2') < composed.indexOf('<details class="cash-more-options"><summary>Propina y división de cuenta</summary>'),
  'Dividir cuenta debe quedar visible antes de Propina y división de cuenta'
);
assert.match(layer, /bridge\.open\(tableId\)/);
assert.match(layer, /RESTAURANT_SPLIT_BRIDGE_UNAVAILABLE_V76_2/);

console.log('RESTAURANT CASH COLLECT DIALOG V40.1 + STATIC SPLIT V76.2 SMOKE OK', JSON.stringify({
  directCollectDialog:true,
  preservesBasePaymentBindings:true,
  noScrollDependency:true,
  rerenderSafe:true,
  orphanBackdropGuard:true,
  finiteStabilityWindow:true,
  noPermanentPolling:true,
  noMutationObserver:true,
  splitEntryStaticInCashTemplate:true,
  splitUsesCanonicalPaymentDialog:true,
  noDynamicPaymentScriptReload:true
}));
