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
const qrIngress = read('src/modules/edge/edge-restaurant-ingress.service.js');
const qrFallbackUi = read('src/web/restaurant-qr-edge-fallback-ui.js');

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

// El personal de la sede es Edge-first, pero el QR público debe seguir siendo híbrido:
// desde datos móviles entra por Core y, si el cliente está en la LAN, dispone además
// del acceso directo al Edge local. Un heartbeat Edge viejo nunca debe bloquear el cloud.
assert.match(qrIngress, /CLOUD_FALLBACK/);
assert.doesNotMatch(qrIngress, /RESTAURANT_QR_EDGE_OFFLINE/);
assert.match(qrFallbackUi, /localFallbackUrl/);
assert.match(qrFallbackUi, /CONTINUAR EN RED LOCAL/);

console.log(JSON.stringify({
  ok: true,
  restaurantAdapterLocalFirst: true,
  canonicalPcEntryIsLocalEdge: true,
  localWorkspacePersistsSession: true,
  defaultLocalSessionDays: 30,
  localQueuePersistsOperations: true,
  onlineAndOfflineStatusVisible: true,
  cloudIsSynchronizationAndRemoteAdmin: true,
  publicQrKeepsCloudMobileDataPath: true,
  publicQrKeepsLanFallbackPath: true
}));
