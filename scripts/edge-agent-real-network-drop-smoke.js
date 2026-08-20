const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}
function close(server) { return new Promise((resolve) => server.close(() => resolve())); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = http.createServer();
  const p = await listen(s, 0);
  await close(s);
  return p;
}

async function waitFor(fn, timeoutMs = 15000, interval = 200) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(interval);
  }
  throw last || new Error('Timeout esperando condición');
}

function fakeBootstrap() {
  return {
    tenant: { id: 'tenant-edge-qa', nombreEmpresa: 'VantixGC Edge QA', moneda: 'COP', pais: 'CO' },
    edge: { id: 'edge-agent-qa', pointCode: 'CAJA-QA', name: 'Caja QA', defaultCustomerId: 'customer-qa', defaultCashAccountId: 'cash-qa' },
    offlinePolicy: { paymentPolicy: 'CASH_ONLY', manualPaymentNote: null },
    products: [{ id: 'product-qa', sku: 'P-QA', codigoBarras: null, nombre: 'Producto Offline QA', tipo: 'PRODUCTO', unidadMedida: 'UND', controlaInventario: true, stockActual: 1, costoPromedio: 4000, precio1: 10000, ivaPct: 0, impoconsumoPct: 0 }],
    recipes: [],
    cashAccounts: [{ id: 'cash-qa', nombre: 'Caja General', tipo: 'CAJA' }],
    printers: [],
    configurationFingerprint: 'cfg-qa-v1',
    snapshotVersion: 'snapshot-qa-v1',
    generatedAt: new Date().toISOString()
  };
}

function makeCentral(received) {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/edge/api/v1/bootstrap') return res.end(JSON.stringify({ ok: true, data: fakeBootstrap() }));
    if (req.url === '/edge/api/v1/ping') return res.end(JSON.stringify({ ok: true, connected: true }));
    if (req.url === '/edge/api/v1/sync/operations') {
      received.push(...(body.operations || []));
      return res.end(JSON.stringify({ ok: true, data: (body.operations || []).map((op) => ({ id: op.id, ok: true, state: 'SYNCED', originDocumentId: `central-${op.id}` })) }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  });
}

async function main() {
  const received = [];
  const centralPort = await freePort();
  let central = makeCentral(received);
  await listen(central, centralPort);

  let printedBytes = 0;
  const printer = net.createServer((socket) => socket.on('data', (chunk) => { printedBytes += chunk.length; }));
  const printerPort = await listen(printer, 0);

  const edgePort = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-edge-qa-'));
  const child = spawn(process.execPath, ['edge/agent/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      CORE_BASE_URL: `http://127.0.0.1:${centralPort}`,
      EDGE_AGENT_ID: 'edge-agent-qa',
      EDGE_AGENT_KEY: 'edge-key-qa',
      EDGE_LOCAL_ENCRYPTION_KEY: 'local-encryption-key-qa-0123456789abcdef',
      EDGE_DB_PATH: path.join(tempDir, 'edge.sqlite'),
      EDGE_PORT: String(edgePort),
      EDGE_SYNC_INTERVAL_MS: '2000',
      EDGE_RETRY_BASE_MS: '500',
      EDGE_HTTP_TIMEOUT_MS: '800',
      EDGE_RECEIPT_PRINTER_HOST: '127.0.0.1',
      EDGE_RECEIPT_PRINTER_PORT: String(printerPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${edgePort}/api/catalog`);
      return r.ok;
    });
    let status = await (await fetch(`http://127.0.0.1:${edgePort}/api/status`)).json();
    assert.equal(status.connected, true);
    assert.equal(status.offlinePolicy.paymentPolicy, 'CASH_ONLY');

    await close(central);
    await waitFor(async () => {
      const s = await (await fetch(`http://127.0.0.1:${edgePort}/api/status`)).json();
      return s.connected === false ? s : null;
    }, 10000);

    const html = await (await fetch(`http://127.0.0.1:${edgePort}/`)).text();
    assert.match(html, /Sin conexión: solo se aceptan pagos en efectivo/);

    const blockedCard = await fetch(`http://127.0.0.1:${edgePort}/api/sales`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ productId: 'product-qa', quantity: 1 }], paymentMode: 'MANUAL_EXTERNAL_PENDING' })
    });
    const blockedBody = await blockedCard.json();
    assert.equal(blockedCard.status, 400);
    assert.equal(blockedBody.code, 'EDGE_OFFLINE_CASH_ONLY');

    const saleResponse = await fetch(`http://127.0.0.1:${edgePort}/api/sales`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [{ productId: 'product-qa', quantity: 1 }], paymentMode: 'CASH', cashReceived: 10000 })
    });
    const sale = await saleResponse.json();
    assert.equal(saleResponse.status, 201);
    assert.equal(sale.data.total, 10000);
    assert.equal(sale.data.pending >= 1, true);
    await waitFor(() => printedBytes > 0, 5000);

    status = await (await fetch(`http://127.0.0.1:${edgePort}/api/status`)).json();
    assert.equal(status.mode, 'OFFLINE');
    assert.equal(status.pending >= 1, true);

    // Los bytes pueden llegar al socket antes de que el callback de impresión registre la evidencia.
    // Esperamos explícitamente el evento para no convertir una carrera de milisegundos en un falso fallo de CI.
    const evidenceOffline = await waitFor(async () => {
      const evidence = await (await fetch(`http://127.0.0.1:${edgePort}/api/field-evidence`)).json();
      return evidence.ok && evidence.data.events.some((x) => x.eventType === 'PRINT_SUCCEEDED') ? evidence : null;
    }, 5000, 100);
    assert.ok(evidenceOffline.data.events.some((x) => x.eventType === 'CORE_DISCONNECTED'));
    assert.ok(evidenceOffline.data.events.some((x) => x.eventType === 'LOCAL_SALE_CREATED'));
    assert.ok(evidenceOffline.data.events.some((x) => x.eventType === 'PRINT_SUCCEEDED'));

    central = makeCentral(received);
    await listen(central, centralPort);
    await waitFor(async () => {
      const s = await (await fetch(`http://127.0.0.1:${edgePort}/api/status`)).json();
      return s.connected && s.pending === 0 ? s : null;
    }, 15000);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'SALE_EMIT');
    assert.equal(received[0].payload.detalles[0].precioUnitario, 10000);

    const evidenceOnline = await waitFor(async () => {
      const evidence = await (await fetch(`http://127.0.0.1:${edgePort}/api/field-evidence`)).json();
      return evidence.data.events.some((x) => x.eventType === 'OPERATION_SYNCED') ? evidence : null;
    }, 5000, 100);
    assert.equal(evidenceOnline.data.status.pending, 0);

    const dbBytes = fs.readFileSync(path.join(tempDir, 'edge.sqlite'));
    assert.equal(dbBytes.includes(Buffer.from('Producto Offline QA')), false, 'El payload sensible no debe quedar plano en SQLite');

    console.log('EDGE AGENT REAL NETWORK DROP + CLOSURE SMOKE OK');
    console.log(JSON.stringify({
      actualCentralSocketStopped: true,
      offlineCashSaleCompleted: true,
      cashOnlyPolicyBlocksCardQr: true,
      localEncryptedSqlite: true,
      visibleOfflineIndicator: true,
      rawEscPosPrintedWhileCentralDown: printedBytes > 0,
      automaticReconnectAndSync: true,
      fieldEvidenceExport: true,
      queuedOperationsReceived: received.length,
      physicalPrinterTested: false,
      physicalWanDisconnected: false
    }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(2000)]);
    try { await close(central); } catch {}
    try { await close(printer); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (stderr && !/ExperimentalWarning/.test(stderr)) console.error(stderr);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
