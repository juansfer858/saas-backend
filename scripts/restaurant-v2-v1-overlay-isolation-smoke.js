'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bridge = fs.readFileSync('src/web/restaurant-v2-control-center-bridge.js','utf8');
assert.match(bridge,/html\[data-restaurant-v2-workspace="1"\] #restaurantAccountAttentionDock/);
assert.match(bridge,/html\[data-restaurant-v2-cutover="1"\] #restaurantAccountAttentionDock/);
assert.match(bridge,/function suppressLegacyOperationalOverlays\(\)/);
assert.match(bridge,/document\.getElementById\('restaurantAccountAttentionDock'\)\?\.remove\(\)/);
assert.match(bridge,/dataset\.restaurantV2Workspace\s*=\s*'1'/);
assert.match(bridge,/dataset\.restaurantV2Workspace\s*=\s*'0'/);
assert.doesNotMatch(bridge,/MutationObserver|setInterval|POLL_MS/);
console.log(JSON.stringify({ok:true,marker:'RESTAURANT_V2_V1_OVERLAY_ISOLATION_OK',legacyAccountDockSuppressed:true,rollbackUntouched:true}));
