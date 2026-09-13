'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const registry = read('edge/runtime/vertical-registry.js');
const universal = read('edge/agent/universal-entry.js');
const restaurantEntry = read('edge/agent/restaurant-entry-v2.js');
const localFirstEntry = read('edge/agent/workspace-entry-local-first-p0.js');
const workspaceEntry = read('edge/agent/workspace-entry.js');
const workspaceUi = read('edge/workspace/public/index.html');
const installer = read('edge/supervisor/install-windows.ps1');
const sync = read('src/modules/edge/edge-restaurant-sync.service.js');

assert.match(registry, /RESTAURANT:[\s\S]*localFirst:\s*true/);
assert.match(registry, /entry:\s*path\.join\(__dirname, '\.\.', 'agent', 'restaurant-entry-v2\.js'\)/);

assert.match(universal, /const cached = online \|\| readCachedManifest\(\)/);
assert.match(universal, /startWithManifest\(cached \|\|/);

assert.match(restaurantEntry, /workspace-entry-local-first-p0/);
assert.doesNotMatch(restaurantEntry, /require\('\.\/workspace-entry-v59'\)/);
assert.match(localFirstEntry, /30 \* 24 \* 60 \* 60 \* 1000/);
assert.match(localFirstEntry, /if \(!process\.env\.EDGE_WORKSPACE_SESSION_MS\)/);
assert.match(localFirstEntry, /require\('\.\/workspace-entry-v59'\)/);

assert.match(workspaceEntry, /EDGE_WORKSPACE_SESSION_MS/);
assert.match(workspaceEntry, /workspace_session:/);
assert.match(workspaceUi, /Operación local-first de esta sede/);
assert.match(workspaceUi, /LOCAL · SIN INTERNET/);
assert.match(workspaceUi, /La sede continúa operando sobre Edge/);

assert.match(installer, /VantixGC Restaurantes\.url/);
assert.match(installer, /URL=http:\/\/127\.0\.0\.1:\$Port\/app\/centro-de-control/);
assert.match(installer, /Install-RestaurantShortcut \$EdgePort/);

for (const type of [
  'RESTAURANT_TABLE_OPEN',
  'RESTAURANT_ORDER_CREATE',
  'RESTAURANT_COMMAND_STATUS',
  'RESTAURANT_CASH_OPEN',
  'RESTAURANT_CASH_CLOSE',
  'RESTAURANT_TABLE_CLOSE'
]) {
  assert.match(sync, new RegExp(type));
}

const deliveryOfflineReady = /RESTAURANT_DELIVERY_CREATE/.test(sync);

console.log(JSON.stringify({
  ok: true,
  phase: 'LOCAL_FIRST_P0',
  edgeIsPrimaryRestaurantEntry: true,
  cachedManifestBootsWithoutInternet: true,
  localDesktopShortcutContract: true,
  localSessionDefaultDays: 30,
  offlineStatusIsVisibleWithoutBlocking: true,
  tablesOffline: true,
  waiterOrdersOffline: true,
  kdsStateOffline: true,
  cashBasicOffline: true,
  deliveryOfflineReady,
  nextGap: deliveryOfflineReady ? null : 'DOMICILIOS_LOCAL_FIRST'
}, null, 2));
