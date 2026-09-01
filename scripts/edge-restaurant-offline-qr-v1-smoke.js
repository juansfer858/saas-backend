'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-edge-qr-'));
const dbPath = path.join(temp, 'edge.sqlite');
process.env.EDGE_LOCAL_ENCRYPTION_KEY = 'edge-offline-qr-smoke-encryption-key-2026';
process.env.EDGE_DB_PATH = dbPath;
process.env.EDGE_DATA_DIR = temp;
process.env.EDGE_INSTALL_ROOT = root;

const { EdgeStore } = require('../edge/agent/store');
const qrModule = require('../edge/agent/offline-qr-self-order');

assert.equal(qrModule.marker, 'EDGE_RESTAURANT_QR_OFFLINE_LAN_V1');
assert.equal(qrModule.isPrivateLanAddress('127.0.0.1'), true);
assert.equal(qrModule.isPrivateLanAddress('192.168.10.25'), true);
assert.equal(qrModule.isPrivateLanAddress('10.1.2.3'), true);
assert.equal(qrModule.isPrivateLanAddress('172.31.9.4'), true);
assert.equal(qrModule.isPrivateLanAddress('8.8.8.8'), false);
assert.equal(qrModule.isPrivateLanAddress('172.32.0.1'), false);

const qrSource = fs.readFileSync(path.join(root, 'edge/agent/offline-qr-self-order.js'), 'utf8');
const fallbackSource = fs.readFileSync(path.join(root, 'src/web/restaurant-qr-edge-fallback-ui.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(root, 'src/modules/edge/edge-restaurant-sync.service.js'), 'utf8');
const entrySource = fs.readFileSync(path.join(root, 'edge/agent/restaurant-entry-v2.js'), 'utf8');
assert.doesNotMatch(qrSource, /setInterval|MutationObserver/);
assert.doesNotMatch(fallbackSource, /setInterval|MutationObserver/);
assert.match(syncSource, /qrToken:\s*table\.qrToken/);
assert.match(syncSource, /visitCode:\s*visitPayments\.visitCode/);
assert.match(syncSource, /orderSource\s*\|\|\s*''/);
assert.match(syncSource, /source:\s*'QR'/);
assert.ok(entrySource.indexOf("require('./offline-qr-self-order')") < entrySource.indexOf("require('./offline-waiter-hard-gate')"));

const writer = new EdgeStore(dbPath, process.env.EDGE_LOCAL_ENCRYPTION_KEY);
const QR = 'qr-smoke-table-01';
const SESSION = 'session-smoke-01';
const MENU = 'menu-smoke-01';

writer.putSnapshot('bootstrap', 'smoke', {
  tenant: { id: 'tenant-smoke', nombreEmpresa: 'Restaurante Smoke Edge' },
  edge: { id: 'edge-smoke', pointCode: 'LOCAL-01' }
});
writer.putSnapshot('restaurant', 'smoke-1', {
  generatedAt: new Date().toISOString(),
  tables: [{
    id: 'table-smoke-01',
    code: 'M01',
    name: 'Mesa 1',
    state: 'OCUPADA',
    qrToken: QR,
    activeSession: {
      id: SESSION,
      state: 'ABIERTA',
      guestCount: 2,
      billingMode: 'INDIVIDUAL',
      visitCode: '1234',
      acceptsQrOrders: true
    }
  }],
  menu: [{
    id: MENU,
    productId: 'product-smoke-01',
    category: 'FUERTES',
    station: 'COCINA',
    available: true,
    product: {
      id: 'product-smoke-01',
      nombre: 'Hamburguesa Smoke',
      precio1: 10000,
      ivaPct: 19,
      impoconsumoPct: 8
    }
  }],
  commands: [],
  cashShifts: []
});

function requestJson(base, pathname, options = {}) {
  return fetch(`${base}${pathname}`, {
    cache: 'no-store',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  }).then(async (response) => ({
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => ({}))
  }));
}

const server = http.createServer((_req, res) => {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('fallback');
});

(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${base}/r/${encodeURIComponent(QR)}?mode=lan`, { cache: 'no-store' });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-vantixgc-edge-qr'), 'offline-lan-v1');
  const pageText = await page.text();
  assert.match(pageText, /MODO LOCAL · RED DEL RESTAURANTE/);
  assert.match(pageText, /REVISAR PEDIDO/);
  assert.match(pageText, /CONFIRMAR PEDIDO/);

  let response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/context`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.local, true);
  assert.equal(response.body.data.visit.authorized, false);
  assert.equal(response.body.data.session.guestCount, 2);
  assert.equal(response.body.data.menu[0].product.nombre, 'Hamburguesa Smoke');

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/autorizar`, {
    method: 'POST',
    body: JSON.stringify({ code: '9999', seatNumber: 2 })
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'EDGE_QR_VISIT_CODE_INVALID');

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/autorizar`, {
    method: 'POST',
    body: JSON.stringify({ code: '1234', seatNumber: 2 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.seatNumber, 2);
  assert.equal(response.body.data.local, true);
  const visitToken = response.body.data.visitToken;
  assert.ok(visitToken && visitToken.length >= 32);

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/visita`, {
    headers: { 'x-vantix-restaurant-visit': visitToken }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.authorized, true);
  assert.equal(response.body.data.seatNumber, 2);

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/pedidos`, {
    method: 'POST',
    headers: { 'x-vantix-restaurant-visit': visitToken },
    body: JSON.stringify({
      items: [{ menuItemId: MENU, quantity: 2 }],
      confirmedTotal: 1,
      externalRequestId: 'smoke-request-tamper'
    })
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'EDGE_QR_TOTAL_CHANGED');
  assert.equal(writer.pendingCount(), 0);

  const payload = {
    items: [{ menuItemId: MENU, quantity: 2, notes: 'Sin cebolla' }],
    confirmedTotal: 25400,
    externalRequestId: 'smoke-request-001'
  };
  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/pedidos`, {
    method: 'POST',
    headers: { 'x-vantix-restaurant-visit': visitToken },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.source, 'QR');
  assert.equal(response.body.data.local, true);
  assert.equal(response.body.data.seatNumber, 2);
  assert.equal(response.body.data.total, 25400);
  const firstOperationId = response.body.data.operationId;

  const pending = writer.listPending(10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, firstOperationId);
  assert.equal(pending[0].type, 'RESTAURANT_ORDER_CREATE');
  assert.equal(pending[0].payload.orderSource, 'QR');
  assert.equal(pending[0].payload.sessionId, SESSION);
  assert.equal(pending[0].payload.items[0].seatNumber, 2);
  assert.equal(pending[0].payload.items[0].serviceBillingMode, 'INDIVIDUAL');
  assert.equal(pending[0].payload.items[0].serviceGuestCount, 2);

  const stateAfterOrder = writer.getSnapshot('restaurant').payload;
  const localCommand = stateAfterOrder.commands.find((row) => row.localOrderOperationId === firstOperationId);
  assert.ok(localCommand, 'El pedido QR debe crear comanda local antes de sincronizar');
  assert.equal(localCommand.source, 'QR');
  assert.equal(localCommand.station, 'COCINA');
  assert.equal(localCommand.state, 'PENDIENTE');
  assert.equal(localCommand.table.id, 'table-smoke-01');
  assert.equal(localCommand.items[0].seatNumber, 2);
  assert.equal(localCommand.items[0].notes, 'Sin cebolla');

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/pedidos`, {
    method: 'POST',
    headers: { 'x-vantix-restaurant-visit': visitToken },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.operationId, firstOperationId);
  assert.equal(writer.pendingCount(), 1, 'El mismo externalRequestId no puede duplicar la operación');
  const stateAfterRetry = writer.getSnapshot('restaurant').payload;
  assert.equal(stateAfterRetry.commands.filter((row) => row.localOrderOperationId === firstOperationId).length, 1);

  const rotated = writer.getSnapshot('restaurant').payload;
  rotated.tables[0].activeSession.visitCode = '5678';
  writer.putSnapshot('restaurant', 'smoke-rotated-code', rotated);

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/visita`, {
    headers: { 'x-vantix-restaurant-visit': visitToken }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.authorized, false, 'Cambiar el código debe invalidar el teléfono local anterior');

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/pedidos`, {
    method: 'POST',
    headers: { 'x-vantix-restaurant-visit': visitToken },
    body: JSON.stringify({ items: [{ menuItemId: MENU, quantity: 1 }], confirmedTotal: 12700 })
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'EDGE_QR_VISIT_INVALID');

  response = await requestJson(base, `/local-qr/api/${encodeURIComponent(QR)}/autorizar`, {
    method: 'POST',
    body: JSON.stringify({ code: '5678', seatNumber: 1 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.seatNumber, 1);

  console.log('EDGE RESTAURANT OFFLINE QR V1 SMOKE OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await new Promise((resolve) => server.close(resolve));
  writer.close();
  fs.rmSync(temp, { recursive: true, force: true });
});
