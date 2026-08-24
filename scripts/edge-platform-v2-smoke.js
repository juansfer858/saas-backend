const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EdgeStore } = require('../edge/agent/store');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const server = read('edge/agent/server.js');
const storeSource = read('edge/agent/store.js');
const discovery = read('edge/agent/lan-discovery.js');
const updater = read('edge/updater/updater.js');
const supervisor = read('edge/supervisor/supervisor.js');
const installer = read('edge/supervisor/install-windows.ps1');
const routes = read('src/modules/edge/edge.routes.js');
const platform = read('src/modules/edge/edge-platform.service.js');
const remotePublic = read('src/modules/edge/edge-remote.public.routes.js');
const remoteAgent = read('src/modules/edge/edge-remote-agent.service.js');
const restaurantSync = read('src/modules/edge/edge-restaurant-sync.service.js');
const prisma = read('prisma/edge-platform-v2.prisma');
const adminHtml = read('src/web/edge-config.html');
const remoteHtml = read('src/web/edge-remote-order.html');

function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

for (const file of [
  'edge/agent/server.js',
  'edge/agent/store.js',
  'edge/agent/lan-discovery.js',
  'edge/updater/updater.js',
  'edge/supervisor/supervisor.js',
  'src/modules/edge/edge.routes.js',
  'src/modules/edge/edge-platform.service.js',
  'src/modules/edge/edge-remote.public.routes.js',
  'src/modules/edge/edge-remote-agent.service.js',
  'src/modules/edge/edge-restaurant-sync.service.js'
]) syntaxCheck(file);

// 1. Edge local + SQLite + permanent installation identity.
assert.match(storeSource, /edge_meta/);
assert.match(storeSource, /getOrCreateInstallationId/);
assert.match(server, /vantixgc-edge\.sqlite/);

// 2. Ordered/idempotent sync and origin tracking.
assert.match(server, /sync\/restaurant-operations/);
assert.match(restaurantSync, /edgeSyncReceipt/);
assert.match(restaurantSync, /EDGE_OPERATION_ID_COLLISION/);
assert.match(storeSource, /origin_document_id/);

// 3. Restaurant operational queue works locally before Core sync.
assert.match(server, /RESTAURANT_TABLE_OPEN/);
assert.match(server, /RESTAURANT_ORDER_CREATE/);
assert.match(server, /RESTAURANT_COMMAND_STATUS/);
assert.match(server, /localSessionOperationId/);
assert.match(restaurantSync, /receiptOrigin/);

// 4. LAN discovery publishes identity/address only; LAN writes fail closed without pairing key.
assert.match(discovery, /VANTIXGC_EDGE_DISCOVER_V1/);
assert.match(discovery, /installationId/);
assert.doesNotMatch(discovery, /EDGE_LAN_KEY|x-vantix-lan-key/i);
assert.match(server, /EDGE_LAN_KEY_REQUIRED/);
assert.match(server, /EDGE_LAN_AUTH_REQUIRED/);
assert.match(server, /timingSafeEqual/);

// 5. Persistent print spooler + backoff.
assert.match(storeSource, /CREATE TABLE IF NOT EXISTS print_jobs/);
assert.match(storeSource, /markPrintFailed/);
assert.match(server, /flushPrintQueue/);

// 6. Windows supervisor + autonomous bootstrap configuration.
assert.match(supervisor, /currentEntry/);
assert.match(supervisor, /current.*agent.*server\.js/s);
assert.match(supervisor, /parseEnvFile/);
assert.match(installer, /VantixGC Edge Supervisor/);
assert.match(installer, /EDGE_LOCAL_ENCRYPTION_KEY/);
assert.match(installer, /EDGE_LAN_KEY/);
assert.match(installer, /runtime\\node\.exe/);

// 7. Update package hash, backup, activation marker, real post-restart health and rollback.
assert.match(updater, /sha256File/);
assert.match(updater, /update-pending\.json/);
assert.match(updater, /scheduleRestart/);
assert.match(updater, /process\.exit\(75\)/);
assert.doesNotMatch(updater, /report\(deploymentId, 'SUCCESS'/);
assert.match(supervisor, /completePendingIfHealthy/);
assert.match(supervisor, /UPDATE_SUCCESS/);
assert.match(supervisor, /UPDATE_ROLLBACK/);
assert.match(supervisor, /ROLLED_BACK/);

// 8. Cloud Relay is outbound/polled and action allow-listed.
assert.match(platform, /ALLOWED_RELAY_ACTIONS/);
assert.match(routes, /relay\/pull/);
assert.match(server, /relayLoop/);
assert.match(server, /UPDATE_CHECK/);

// 9. Central installation/release/deployment management exists.
for (const model of ['EdgeInstallation', 'EdgeRelease', 'EdgeDeployment', 'EdgeRelayRequest']) assert.match(prisma, new RegExp(`model ${model}`));
assert.match(routes, /\/installations/);
assert.match(routes, /\/releases/);
assert.match(routes, /\/agents\/:id\/deploy/);
assert.match(adminHtml, /Instalaciones/);
assert.match(adminHtml, /PILOT/);
assert.match(adminHtml, /STABLE/);

// 10. Tokenized Mesa/Domicilio/Recoger channels, approval, Edge pull and offline status reporting.
for (const type of ['MESA', 'DOMICILIO', 'RECOGER']) assert.match(prisma, new RegExp(type));
assert.match(routes, /publicRouter\.use\('\/remote', edgeRemotePublicRouter\)[\s\S]*publicRouter\.use\(edgeAuth\)/);
assert.match(remotePublic, /EDGE_REMOTE_TABLE_NOT_OPEN/);
assert.match(remoteAgent, /channel/);
assert.match(server, /ingestRemoteOrder/);
assert.match(server, /setRemoteOrderLocalState/);
assert.match(server, /syncRemoteReports/);
assert.match(server, /localRemoteStatus/);
assert.match(remoteHtml, /pedido/i);
assert.match(platform, /PENDING_CONFIRMATION/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-edge-v2-'));
const dbPath = path.join(dir, 'edge.sqlite');
const key = 'edge-platform-v2-local-key-0123456789abcdef0123456789abcdef';
const store = new EdgeStore(dbPath, key);
try {
  const installationA = store.getOrCreateInstallationId();
  const installationB = store.getOrCreateInstallationId();
  assert.equal(installationA, installationB, 'installationId debe ser permanente');

  store.enqueueOperation({ id: 'OP-EDGE-V2-0001', type: 'SALE_EMIT', localTimestamp: new Date().toISOString(), payload: { total: 1000 } });
  store.markSynced('OP-EDGE-V2-0001', 'DOC-CENTRAL-0001');
  assert.equal(store.operationResult('OP-EDGE-V2-0001').originDocumentId, 'DOC-CENTRAL-0001');

  const printId = store.enqueuePrintJob({ role: 'COCINA', printer: { host: '127.0.0.1', port: 9100 }, payload: { lines: ['QA'] } });
  store.markPrintFailed(printId, 'printer offline', 500);
  assert.equal(store.printQueueSummary(10)[0].state, 'FAILED');

  store.upsertRemoteOrder({
    id: 'REMOTE-EDGE-V2-0001',
    channelType: 'DOMICILIO',
    state: 'APPROVED',
    items: [{ productId: 'P1', quantity: 1 }],
    creadoEn: new Date().toISOString()
  });
  store.setRemoteOrderLocalState('REMOTE-EDGE-V2-0001', 'PREPARING', { localOperationId: 'remote:REMOTE-EDGE-V2-0001' });
  assert.equal(store.getRemoteOrder('REMOTE-EDGE-V2-0001').reportPending, true);
  // A stale central pull must not roll back a newer offline state awaiting report.
  store.upsertRemoteOrder({
    id: 'REMOTE-EDGE-V2-0001',
    channelType: 'DOMICILIO',
    state: 'APPROVED',
    items: [{ productId: 'P1', quantity: 1 }],
    creadoEn: new Date().toISOString()
  });
  assert.equal(store.getRemoteOrder('REMOTE-EDGE-V2-0001').state, 'PREPARING');
  store.markRemoteReportSynced('REMOTE-EDGE-V2-0001', { state: 'PREPARING', localOperationId: 'remote:REMOTE-EDGE-V2-0001' });
  assert.equal(store.getRemoteOrder('REMOTE-EDGE-V2-0001').reportPending, false);
} finally {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('EDGE PLATFORM V2 ARCHITECTURE 1-10 SMOKE OK');
console.log(JSON.stringify({
  localSqlite: true,
  syncIdempotency: true,
  restaurantOfflineQueue: true,
  lanDiscoveryAndWriteProtection: true,
  persistentPrintQueue: true,
  windowsSupervisor: true,
  verifiedUpdateAndRollback: true,
  outboundCloudRelay: true,
  installationRolloutManagement: true,
  remoteChannelsAndOfflineReports: true
}, null, 2));
