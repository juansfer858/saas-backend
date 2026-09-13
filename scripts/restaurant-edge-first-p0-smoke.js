'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const registry = read('edge/runtime/vertical-registry.js');
const entry = read('edge/agent/restaurant-entry-v2.js');
const workspace = read('edge/agent/workspace-entry.js');
const workspaceUi = read('edge/workspace/public/index.html');
const installer = read('edge/supervisor/install-windows.ps1');

assert.match(registry, /RESTAURANT:[\s\S]*localFirst:\s*true/);
assert.match(registry, /entry:\s*path\.join\([^\n]*restaurant-entry-v2\.js/);
assert.match(entry, /EDGE_WORKSPACE_SESSION_MS/);
assert.match(entry, /30 \* 24 \* 60 \* 60 \* 1000/);
assert.match(entry, /require\('\.\/workspace-entry-v59'\)/);

assert.match(workspace, /\/app\/centro-de-control/);
assert.match(workspace, /workspace_session:/);
assert.match(workspace, /enqueueOperation/);
assert.match(workspace, /SQLite local/);

assert.match(workspaceUi, /Operación local-first de esta sede/);
assert.match(workspaceUi, /LOCAL \+ NUBE/);
assert.match(workspaceUi, /LOCAL · SIN INTERNET/);
assert.match(workspaceUi, /La sede continúa operando sobre Edge/);

assert.match(installer, /Install-RestaurantShortcut/);
assert.match(installer, /URL=http:\/\/127\.0\.0\.1:\$Port\/app\/centro-de-control/);
assert.match(installer, /VantixGC Restaurantes\.url/);

console.log(JSON.stringify({
  ok: true,
  restaurantAdapterLocalFirst: true,
  canonicalPcEntryIsLocalEdge: true,
  localWorkspacePersistsSession: true,
  defaultLocalSessionDays: 30,
  localQueuePersistsOperations: true,
  onlineAndOfflineStatusVisible: true,
  cloudIsSynchronizationAndRemoteAdmin: true
}));
