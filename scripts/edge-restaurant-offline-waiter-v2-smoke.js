'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EdgeStore } = require('../edge/agent/store');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantixgc-edge-waiter-v2-'));
const dbPath = path.join(temp, 'vantixgc-edge.sqlite');
const localKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const sessionId = 'offline-waiter-smoke-session';
let child = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function signature(value) {
  return crypto.createHmac('sha256', `${localKey}|vantixgc-edge-workspace-v1`).update(String(value)).digest('base64url');
}

function cookie() {
  return `vantixgc_edge_workspace=${sessionId}.${signature(sessionId)}`;
}

function seed() {
  const store = new EdgeStore(dbPath, localKey);
  store.putSnapshot('restaurant', 'offline-smoke-seed', {
    tables: [{
      id: 'table-1',
      code: 'T1',
      name: 'Mesa 1',
      seats: 4,
      state: 'OCUPADA',
      assignedWaiterId: null,
      activeSession: {
        id: 'session-1',
        state: 'ABIERTA',
        saleId: 'sale-1',
        guestCount: 1,
        billingMode: 'CONJUNTA'
      }
    }],
    menu: [
      {
        id: 'menu-burger',
        productId: 'product-burger',
        category: 'Comidas',
        station: 'COCINA',
        available: true,
        product: { id: 'product-burger', sku: 'HAMB-01', nombre: 'Hamburguesa', precio1: 25000, ivaPct: 0, impoconsumoPct: 8 }
      },
      {
        id: 'menu-juice',
        productId: 'product-juice',
        category: 'Bebidas',
        station: 'BARRA',
        available: true,
        product: { id: 'product-juice', sku: 'JUGO-01', nombre: 'Jugo natural', precio1: 9000, ivaPct: 0, impoconsumoPct: 0 }
      }
    ],
    commands: [],
    cashShifts: []
  });
  store.putSnapshot('workspace-ledger', 'offline-smoke-seed', { tables: {}, closed: [] });
  store.setMeta(`workspace_session:${sessionId}`, {
    snapshot: {
      user: { id: 'waiter-1', tenantId: 'tenant-1', nombre: 'Mesero Offline', rol: 'MESERO' },
      permissions: ['PEDIDOS.CREAR', 'RESTAURANTE.VER', 'COCINA.VER'],
      edge: { pointCode: 'OFFLINE-SMOKE' }
    },
    expiresAt: Date.now() + 60 * 60 * 1000
  });
  store.close();
}

async function request(port, pathname, { method = 'GET', body, useCookie = true } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(useCookie ? { Cookie: cookie() } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, text, body: parsed };
}

async function waitForEdge(port, stderr) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Edge terminó antes de arrancar (${child.exitCode}).\n${stderr()}`);
    try {
      const status = await request(port, '/api/status', { useCookie: false });
      if (status.status === 200 && status.body?.ok) return status.body;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Edge no arrancó a tiempo.\n${stderr()}`);
}

async function main() {
  seed();
  const port = await freePort();
  const stdout = [];
  const stderr = [];
  child = spawn(process.execPath, [path.join(root, 'edge/agent/restaurant-entry-v2.js')], {
    cwd: root,
    env: {
      ...process.env,
      EDGE_PORT: String(port),
      EDGE_HOST: '127.0.0.1',
      EDGE_DATA_DIR: temp,
      EDGE_DB_PATH: dbPath,
      EDGE_LOCAL_ENCRYPTION_KEY: localKey,
      CORE_BASE_URL: 'http://127.0.0.1:9',
      EDGE_AGENT_ID: '',
      EDGE_AGENT_KEY: '',
      EDGE_AUTO_UPDATE_ENABLED: 'false',
      EDGE_HTTP_TIMEOUT_MS: '300',
      EDGE_POLL_INTERVAL_MS: '60000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  const status = await waitForEdge(port, () => stderr.join(''));
  assert.equal(status.mode, 'OFFLINE');
  assert.equal(status.connected, false);

  const workspace = await request(port, '/app/centro-de-control');
  assert.equal(workspace.status, 200, workspace.text);
  assert.match(workspace.text, /\/workspace\/offline-waiter-v2\.js/);

  let draft = await request(port, '/workspace/api/offline-waiter/tables/table-1');
  assert.equal(draft.status, 200, draft.text);
  assert.equal(draft.body.data.service.billingMode, 'CONJUNTA');
  assert.equal(draft.body.data.service.guestCount, 1);
  assert.deepEqual(draft.body.data.draft.items, []);

  const direct = await request(port, '/workspace/api/tables/table-1/orders', {
    method: 'POST',
    body: { sessionId: 'session-1', items: [{ menuItemId: 'menu-burger', quantity: 1 }] }
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.code, 'EDGE_RESTAURANT_REVIEW_REQUIRED');

  let state = await request(port, '/api/restaurant', { useCookie: false });
  assert.equal(state.body.data.commands.length, 0, 'El envío directo no puede crear KDS');

  const service = await request(port, '/workspace/api/offline-waiter/tables/table-1/service', {
    method: 'PUT',
    body: { billingMode: 'INDIVIDUAL', guestCount: 2 }
  });
  assert.equal(service.status, 200, service.text);
  assert.equal(service.body.data.service.billingMode, 'INDIVIDUAL');
  assert.equal(service.body.data.service.guestCount, 2);

  const line = await request(port, '/workspace/api/offline-waiter/tables/table-1/line', {
    method: 'PUT',
    body: { menuItemId: 'menu-burger', quantity: 2, seatNumber: 2, notes: 'sin cebolla' }
  });
  assert.equal(line.status, 200, line.text);
  assert.equal(line.body.data.draft.items[0].seatNumber, 2);
  assert.equal(line.body.data.draft.items[0].notes, 'sin cebolla');
  assert.equal(line.body.data.draft.total, 54000);

  const beforeReviewConfirm = await request(port, '/workspace/api/offline-waiter/tables/table-1/confirm', { method: 'POST', body: {} });
  assert.equal(beforeReviewConfirm.status, 409);
  assert.equal(beforeReviewConfirm.body.code, 'EDGE_RESTAURANT_REVIEW_REQUIRED');

  state = await request(port, '/api/restaurant', { useCookie: false });
  assert.equal(state.body.data.commands.length, 0, 'Confirmar sin revisión no puede crear KDS');

  const review = await request(port, '/workspace/api/offline-waiter/tables/table-1/review', { method: 'POST', body: {} });
  assert.equal(review.status, 200, review.text);
  assert.equal(review.body.data.draft.reviewedRevision, review.body.data.draft.revision);
  assert.equal(review.body.data.draft.items[0].seatNumber, 2);

  state = await request(port, '/api/restaurant', { useCookie: false });
  assert.equal(state.body.data.commands.length, 0, 'REVISAR PEDIDO no puede crear KDS');

  const decrease = await request(port, '/workspace/api/offline-waiter/tables/table-1/service', {
    method: 'PUT',
    body: { guestCount: 1 }
  });
  assert.equal(decrease.status, 200, decrease.text);
  assert.equal(decrease.body.data.service.guestCount, 1);
  assert.equal(decrease.body.data.draft.items[0].seatNumber, 1, 'Al quitar Persona 2, el consumo debe pasar a Persona 1');
  assert.equal(decrease.body.data.draft.reviewedRevision, null, 'Cambiar personas debe invalidar la revisión previa');

  const staleConfirm = await request(port, '/workspace/api/offline-waiter/tables/table-1/confirm', { method: 'POST', body: {} });
  assert.equal(staleConfirm.status, 409);
  assert.equal(staleConfirm.body.code, 'EDGE_RESTAURANT_REVIEW_REQUIRED');

  const rereview = await request(port, '/workspace/api/offline-waiter/tables/table-1/review', { method: 'POST', body: {} });
  assert.equal(rereview.status, 200, rereview.text);
  assert.equal(rereview.body.data.draft.items[0].seatNumber, 1);

  const confirm = await request(port, '/workspace/api/offline-waiter/tables/table-1/confirm', { method: 'POST', body: {} });
  assert.equal(confirm.status, 201, confirm.text);
  assert.equal(confirm.body.data.reviewGate, 'CONFIRMED');
  assert.equal(confirm.body.data.bill.orders.length, 1);
  assert.equal(confirm.body.data.bill.orders[0].lines[0].seatNumber, 1);
  assert.equal(confirm.body.data.bill.orders[0].lines[0].notes, 'sin cebolla');

  state = await request(port, '/api/restaurant', { useCookie: false });
  assert.equal(state.body.data.commands.length, 1, 'Sólo CONFIRMAR PEDIDO debe crear KDS');
  assert.equal(state.body.data.commands[0].station, 'COCINA');
  assert.equal(state.body.data.commands[0].state, 'PENDIENTE');

  const after = await request(port, '/workspace/api/offline-waiter/tables/table-1');
  assert.equal(after.status, 200, after.text);
  assert.deepEqual(after.body.data.draft.items, [], 'El borrador confirmado debe quedar limpio');

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  child = null;

  const store = new EdgeStore(dbPath, localKey);
  store.db.prepare("UPDATE operations SET next_attempt_at=NULL WHERE type='RESTAURANT_ORDER_CREATE'").run();
  const operations = store.listPending(200).filter((operation) => operation.type === 'RESTAURANT_ORDER_CREATE');
  assert.equal(operations.length, 1, 'Debe quedar exactamente una orden local para reconciliar');
  const queued = operations[0];
  assert.equal(queued.payload.sessionId, 'session-1');
  assert.equal(queued.payload.items.length, 1);
  assert.equal(queued.payload.items[0].seatNumber, 1);
  assert.equal(queued.payload.items[0].notes, 'sin cebolla');
  assert.equal(queued.payload.items[0].serviceBillingMode, 'INDIVIDUAL');
  assert.equal(queued.payload.items[0].serviceGuestCount, 1);
  const ledger = store.getSnapshot('workspace-ledger').payload;
  assert.equal(ledger.tables['table-1'].orders.length, 1);
  assert.equal(ledger.tables['table-1'].orders[0].lines[0].seatNumber, 1);
  store.close();

  console.log(JSON.stringify({
    ok: true,
    contract: 'EDGE_OFFLINE_WAITER_REVIEW_HARD_GATE_V2',
    coreAvailable: false,
    directKitchenSendBlocked: true,
    reviewCreatesKds: false,
    confirmCreatesKds: true,
    personMigrationPreserved: true,
    queuedForSync: true,
    sqliteEncryptedStore: true,
    stdout: stdout.join('').trim().split(/\r?\n/).slice(-3)
  }));
}

main().catch(async (error) => {
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
  console.error(error.stack || error);
  process.exit(1);
}).finally(() => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
});
