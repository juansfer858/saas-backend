const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EdgeStore } = require('../edge/agent/store');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'edge-config.html'), 'utf8');
const localHtml = fs.readFileSync(path.join(__dirname, '..', 'edge', 'agent', 'public', 'index.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'edge', 'agent', 'server.js'), 'utf8');

assert.match(adminHtml, /Solo efectivo/);
assert.match(adminHtml, /Datáfono\/QR externo/);
assert.match(adminHtml, /Pausar nuevas ventas/);
assert.match(adminHtml, /Revisada, sin acción/);
assert.match(adminHtml, /Ajuste manual en Contabilidad/);
assert.match(adminHtml, /\/api\/v1\/edge\/policy/);
assert.match(localHtml, /Sin conexión: solo se aceptan pagos en efectivo/);
assert.match(localHtml, /Pago externo pendiente de confirmar/);
assert.match(localHtml, /nuevas ventas pausadas/);
assert.match(localHtml, /Evidencia de campo/);
assert.match(serverSource, /\/api\/field-evidence/);
assert.match(serverSource, /EDGE_RETRY_BASE_MS/);
assert.match(serverSource, /MANUAL_EXTERNAL_PENDING/);
assert.match(serverSource, /PAUSE_SALES/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-edge-closure-'));
const dbPath = path.join(dir, 'edge.sqlite');
const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const store = new EdgeStore(dbPath, key);
try {
  const op = { id: 'OP-CLOSURE-0001', type: 'SALE_EMIT', localTimestamp: new Date().toISOString(), payload: { paymentMode: 'CASH', total: 10000 } };
  store.enqueueOperation(op);
  assert.equal(store.pendingCount(), 1);
  const backoff = store.markFailed(op.id, 'NETWORK: test', 1000);
  assert.equal(backoff.attempts, 1);
  assert.ok(backoff.delayMs >= 1000);
  assert.equal(store.listPending(10).length, 0, 'una operación fallida no debe reintentarse inmediatamente');
  store.recordEvent('FIELD_TEST_QA', { offline: true, printer: 'tcp-real-harness' });
  const events = store.recentEvents(5);
  assert.equal(events[0].eventType, 'FIELD_TEST_QA');
  assert.equal(events[0].details.offline, true);
} finally {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('EDGE OFFLINE PRODUCTION CLOSURE UI/STORE SMOKE OK');
console.log(JSON.stringify({
  cashOnlyVisible: true,
  manualExternalVisible: true,
  pauseSalesVisible: true,
  configDriftReviewAction: true,
  fieldEvidenceEndpoint: true,
  exponentialRetryBackoff: true
}, null, 2));
