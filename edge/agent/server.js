const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EdgeStore } = require('./store');
const { printJob } = require('../print-spooler/escpos');

const PORT = Number(process.env.EDGE_PORT || 8788);
const HOST = process.env.EDGE_HOST || '127.0.0.1';
const CORE_BASE_URL = String(process.env.CORE_BASE_URL || '').replace(/\/$/, '');
const EDGE_AGENT_ID = process.env.EDGE_AGENT_ID || '';
const EDGE_AGENT_KEY = process.env.EDGE_AGENT_KEY || '';
const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const DB_PATH = process.env.EDGE_DB_PATH || path.join(process.cwd(), 'data', 'vantixgc-edge.sqlite');
const POLL_MS = Math.max(2000, Number(process.env.EDGE_SYNC_INTERVAL_MS || 5000));
const RETRY_BASE_MS = Math.max(500, Number(process.env.EDGE_RETRY_BASE_MS || 5000));
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const store = new EdgeStore(DB_PATH, LOCAL_KEY);

const runtime = {
  connected: false,
  revoked: false,
  syncing: false,
  lastOnlineAt: null,
  lastSyncAt: null,
  lastBootstrapAt: null,
  lastError: null
};

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
  res.end(data);
}

function recordEvent(type, details = {}) {
  try { store.recordEvent(type, details); } catch {}
}

function setConnection(connected, error = null) {
  const changed = runtime.connected !== connected;
  runtime.connected = connected;
  if (connected) {
    runtime.lastOnlineAt = new Date().toISOString();
    runtime.lastError = null;
  } else if (error) runtime.lastError = error.message || String(error);
  if (changed) recordEvent(connected ? 'CORE_CONNECTED' : 'CORE_DISCONNECTED', { error: error?.message || null, pending: store.pendingCount() });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Payload demasiado grande');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function central(pathname, options = {}) {
  if (!CORE_BASE_URL || !EDGE_AGENT_ID || !EDGE_AGENT_KEY) throw Object.assign(new Error('Edge Agent no está provisionado contra un Core'), { code: 'EDGE_NOT_PROVISIONED' });
  let response;
  try {
    response = await fetch(`${CORE_BASE_URL}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(Number(process.env.EDGE_HTTP_TIMEOUT_MS || 5000)),
      headers: {
        'Content-Type': 'application/json',
        'x-vantix-edge-id': EDGE_AGENT_ID,
        'x-vantix-edge-key': EDGE_AGENT_KEY,
        ...(options.headers || {})
      }
    });
  } catch (error) {
    setConnection(false, error);
    throw error;
  }
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = Object.assign(new Error(body?.error?.message || body?.message || `Core HTTP ${response.status}`), { status: response.status, code: body?.error?.code || `HTTP_${response.status}` });
    if (response.status === 401 || response.status === 403) runtime.revoked = true;
    setConnection(false, error);
    throw error;
  }
  runtime.revoked = false;
  setConnection(true);
  return body;
}

async function pingCore() {
  try { await central('/edge/api/v1/ping'); return true; }
  catch { return false; }
}

async function refreshBootstrap(force = false) {
  const current = store.getSnapshot('bootstrap');
  const stale = !current || Date.now() - new Date(current.updatedAt).getTime() > 60000;
  if (!force && !stale) return current;
  const response = await central('/edge/api/v1/bootstrap');
  store.putSnapshot('bootstrap', response.data.snapshotVersion, response.data);
  if (store.pendingCount() === 0) store.resetStockDeltas();
  runtime.lastBootstrapAt = new Date().toISOString();
  recordEvent('BOOTSTRAP_SYNCED', { snapshotVersion: response.data.snapshotVersion, paymentPolicy: response.data.offlinePolicy?.paymentPolicy || 'CASH_ONLY' });
  return store.getSnapshot('bootstrap');
}

async function flushQueue() {
  if (runtime.syncing || runtime.revoked) return;
  runtime.syncing = true;
  try {
    const pending = store.listPending(200);
    for (const operation of pending) {
      try {
        const response = await central('/edge/api/v1/sync/operations', {
          method: 'POST',
          body: JSON.stringify({ operations: [{ id: operation.id, type: operation.type, localTimestamp: operation.localTimestamp, payload: operation.payload }] })
        });
        const result = response.data?.[0];
        if (result?.ok) {
          store.markSynced(operation.id);
          recordEvent('OPERATION_SYNCED', { operationId: operation.id, type: operation.type, originDocumentId: result.originDocumentId || null });
        } else {
          const backoff = store.markFailed(operation.id, `${result?.code || 'EDGE_SYNC_FAILED'}: ${result?.message || 'Sin detalle'}`, RETRY_BASE_MS);
          recordEvent('OPERATION_SYNC_FAILED', { operationId: operation.id, type: operation.type, code: result?.code || 'EDGE_SYNC_FAILED', ...backoff });
        }
      } catch (error) {
        const backoff = store.markFailed(operation.id, `${error.code || 'NETWORK'}: ${error.message}`, RETRY_BASE_MS);
        recordEvent('OPERATION_SYNC_FAILED', { operationId: operation.id, type: operation.type, code: error.code || 'NETWORK', ...backoff });
        if (error.status === 401 || error.status === 403) break;
        if (!error.status) break;
      }
    }
    if (store.pendingCount() === 0 && !runtime.revoked) {
      runtime.lastSyncAt = new Date().toISOString();
      try { await refreshBootstrap(true); } catch (error) { setConnection(false, error); }
    }
  } finally {
    runtime.syncing = false;
  }
}

function catalogWithLocalStock() {
  const snapshot = store.getSnapshot('bootstrap');
  if (!snapshot) return null;
  const data = snapshot.payload;
  return {
    ...data,
    products: (data.products || []).map((p) => ({ ...p, stockCentralSnapshot: Number(p.stockActual || 0), stockLocal: Number(p.stockActual || 0) + store.stockDelta(p.id) }))
  };
}

function calculateSale(input) {
  const catalog = catalogWithLocalStock();
  if (!catalog) throw Object.assign(new Error('No existe catálogo sincronizado. Conecte este punto al menos una vez antes de operar offline.'), { code: 'EDGE_CATALOG_REQUIRED' });
  const products = new Map((catalog.products || []).map((p) => [p.id, p]));
  const recipes = new Map((catalog.recipes || []).filter((r) => r.outputProductId).map((r) => [r.outputProductId, r]));
  const details = [];
  const deltas = new Map();
  let subtotal = 0;
  let iva = 0;
  let impoconsumo = 0;

  for (const requested of input.lines || []) {
    const product = products.get(requested.productId);
    const quantity = Number(requested.quantity || 0);
    if (!product || quantity <= 0) throw new Error('Cada línea requiere un producto sincronizado y cantidad mayor que cero');
    const price = Number(product.precio1 || 0);
    const lineSubtotal = Number((price * quantity).toFixed(2));
    const lineIva = Number((lineSubtotal * Number(product.ivaPct || 0) / 100).toFixed(2));
    const lineConsumptionTax = Number((lineSubtotal * Number(product.impoconsumoPct || 0) / 100).toFixed(2));
    subtotal += lineSubtotal;
    iva += lineIva;
    impoconsumo += lineConsumptionTax;
    details.push({
      productoId: product.id,
      descripcion: product.nombre,
      cantidad: quantity,
      precioUnitario: price,
      descuentoPct: 0,
      ivaPct: Number(product.ivaPct || 0),
      impoconsumoPct: Number(product.impoconsumoPct || 0)
    });

    const recipe = recipes.get(product.id);
    if (recipe) {
      for (const item of recipe.items || []) {
        const q = Number(item.quantity) * quantity;
        deltas.set(item.ingredientProductId, (deltas.get(item.ingredientProductId) || 0) - q);
      }
    } else if (product.controlaInventario) {
      deltas.set(product.id, (deltas.get(product.id) || 0) - quantity);
    }
  }
  if (!details.length) throw new Error('La venta requiere al menos una línea');
  return { catalog, details, deltas, subtotal: Number(subtotal.toFixed(2)), iva: Number(iva.toFixed(2)), impoconsumo: Number(impoconsumo.toFixed(2)), total: Number((subtotal + iva + impoconsumo).toFixed(2)) };
}

async function printReceipt(sale, calculation) {
  const bootstrap = calculation.catalog;
  const configured = (bootstrap.printers || []).find((p) => p.host && (p.role === 'DOCUMENTOS' || p.role === 'CAJA'));
  const host = process.env.EDGE_RECEIPT_PRINTER_HOST || configured?.host;
  if (!host) return { ok: false, skipped: true, reason: 'No hay impresora LAN configurada para ticket' };
  const port = Number(process.env.EDGE_RECEIPT_PRINTER_PORT || configured?.port || 9100);
  const paymentLine = sale.paymentMode === 'MANUAL_EXTERNAL_PENDING'
    ? 'PAGO EXTERNO: PENDIENTE DE CONFIRMAR'
    : `EFECTIVO: $${sale.cashReceived.toLocaleString('es-CO')}`;
  return printJob({ name: configured?.name || 'Ticket', host, port }, {
    title: bootstrap.tenant?.nombreEmpresa || 'VantixGC',
    lines: [
      `Punto: ${bootstrap.edge?.pointCode || ''}`,
      `Venta local: ${sale.localNumber}`,
      ...calculation.details.map((d) => ({ quantity: d.cantidad, name: `${d.descripcion}  $${Number(d.precioUnitario).toLocaleString('es-CO')}` })),
      `TOTAL: $${calculation.total.toLocaleString('es-CO')}`,
      paymentLine
    ],
    footer: runtime.connected ? 'Conectado · sincronización automática' : `MODO OFFLINE · ${store.pendingCount()} pendiente(s)`
  });
}

async function createLocalSale(input) {
  const calculation = calculateSale(input);
  const policy = calculation.catalog.offlinePolicy?.paymentPolicy || 'CASH_ONLY';
  const paymentMode = String(input.paymentMode || 'CASH').toUpperCase();

  if (!runtime.connected && policy === 'PAUSE_SALES') {
    throw Object.assign(new Error('Sin conexión: este negocio configuró pausa de nuevas ventas hasta recuperar Internet.'), { code: 'EDGE_OFFLINE_SALES_PAUSED' });
  }
  if (!runtime.connected && policy === 'CASH_ONLY' && paymentMode !== 'CASH') {
    throw Object.assign(new Error('Sin conexión: solo se aceptan pagos en efectivo.'), { code: 'EDGE_OFFLINE_CASH_ONLY' });
  }
  if (paymentMode === 'MANUAL_EXTERNAL_PENDING' && policy !== 'MANUAL_EXTERNAL_PENDING') {
    throw Object.assign(new Error('El registro manual de datáfono/QR no está habilitado para este negocio.'), { code: 'EDGE_MANUAL_EXTERNAL_DISABLED' });
  }
  if (!['CASH', 'MANUAL_EXTERNAL_PENDING'].includes(paymentMode)) {
    throw Object.assign(new Error('Modo de cobro local no soportado.'), { code: 'EDGE_PAYMENT_MODE_INVALID' });
  }
  if (policy === 'PAUSE_SALES' && !(await pingCore())) {
    throw Object.assign(new Error('No se pudo confirmar conexión con el Core. Nuevas ventas están pausadas por configuración.'), { code: 'EDGE_OFFLINE_SALES_PAUSED' });
  }

  const operationId = crypto.randomUUID();
  const saleId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const localNumber = `${calculation.catalog.edge?.pointCode || 'EDGE'}-${Date.now()}`;
  const manualExternal = paymentMode === 'MANUAL_EXTERNAL_PENDING';
  const cashReceived = manualExternal ? 0 : Number(input.cashReceived ?? calculation.total);
  if (!manualExternal && cashReceived < calculation.total) throw new Error('El efectivo recibido no cubre el total de la venta');
  const paymentStatus = manualExternal ? 'PENDING_CONFIRMATION' : 'PAID_LOCAL';
  const payload = {
    terceroId: input.terceroId || calculation.catalog.edge?.defaultCustomerId || null,
    cajaBancoId: manualExternal ? null : (input.cajaBancoId || calculation.catalog.edge?.defaultCashAccountId || null),
    formaPago: manualExternal ? 'CREDITO' : 'EFECTIVO',
    paymentMode,
    paymentStatus,
    documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    localNumber,
    snapshotVersion: calculation.catalog.snapshotVersion,
    configurationFingerprint: calculation.catalog.configurationFingerprint,
    detalles: calculation.details
  };
  store.enqueueOperation({ id: operationId, type: 'SALE_EMIT', localTimestamp: createdAt, payload });
  store.saveLocalSale({ id: saleId, operationId, localNumber, total: calculation.total, cashReceived, paymentMode, paymentStatus, payload, createdAt });
  for (const [productId, delta] of calculation.deltas.entries()) store.adjustStock(productId, delta);
  recordEvent('LOCAL_SALE_CREATED', { operationId, localNumber, total: calculation.total, paymentMode, paymentStatus, connectedAtCapture: runtime.connected, paymentPolicy: policy });
  const print = await printReceipt({ id: saleId, localNumber, cashReceived, paymentMode }, calculation).catch((error) => ({ ok: false, error: error.message, code: error.code || 'PRINT_ERROR' }));
  recordEvent(print?.ok ? 'PRINT_SUCCEEDED' : 'PRINT_FAILED', { operationId, localNumber, result: print });
  void flushQueue();
  return { id: saleId, operationId, localNumber, total: calculation.total, cashReceived, paymentMode, paymentStatus, change: manualExternal ? 0 : Number((cashReceived - calculation.total).toFixed(2)), print, mode: runtime.connected ? 'CONNECTED' : 'OFFLINE', pending: store.pendingCount(), policy };
}

function currentPolicy() {
  return catalogWithLocalStock()?.offlinePolicy || { paymentPolicy: 'CASH_ONLY', manualPaymentNote: null };
}

function status() {
  return {
    ok: true,
    mode: runtime.connected && !runtime.revoked ? 'CONNECTED' : 'OFFLINE',
    connected: runtime.connected && !runtime.revoked,
    revoked: runtime.revoked,
    pending: store.pendingCount(),
    syncing: runtime.syncing,
    lastOnlineAt: runtime.lastOnlineAt,
    lastSyncAt: runtime.lastSyncAt,
    lastBootstrapAt: runtime.lastBootstrapAt,
    lastError: runtime.lastError,
    provisioned: Boolean(CORE_BASE_URL && EDGE_AGENT_ID && EDGE_AGENT_KEY),
    dbEncryptedPayloads: true,
    offlinePolicy: currentPolicy()
  };
}

function fieldEvidence() {
  const bootstrap = store.getSnapshot('bootstrap');
  return {
    generatedAt: new Date().toISOString(),
    point: bootstrap?.payload?.edge ? { id: bootstrap.payload.edge.id, pointCode: bootstrap.payload.edge.pointCode, name: bootstrap.payload.edge.name } : null,
    tenant: bootstrap?.payload?.tenant ? { id: bootstrap.payload.tenant.id, nombreEmpresa: bootstrap.payload.tenant.nombreEmpresa } : null,
    status: status(),
    operations: store.pendingSummary(200),
    recentSales: store.recentSales(100).map((sale) => ({
      id: sale.id, operationId: sale.operationId, localNumber: sale.localNumber, total: sale.total,
      paymentMode: sale.paymentMode, paymentStatus: sale.paymentStatus, createdAt: sale.createdAt
    })),
    events: store.recentEvents(300)
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') {
      const body = Buffer.from(html);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, status());
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      const data = catalogWithLocalStock();
      return data ? json(res, 200, { ok: true, data }) : json(res, 503, { ok: false, message: 'Catálogo local no inicializado' });
    }
    if (req.method === 'GET' && url.pathname === '/api/sales/recent') return json(res, 200, { ok: true, data: store.recentSales(50) });
    if (req.method === 'GET' && url.pathname === '/api/field-evidence') return json(res, 200, { ok: true, data: fieldEvidence() });
    if (req.method === 'POST' && url.pathname === '/api/sales') return json(res, 201, { ok: true, data: await createLocalSale(await readJson(req)) });
    if (req.method === 'POST' && url.pathname === '/api/sync-now') {
      try { await flushQueue(); await refreshBootstrap(true); } catch (error) { setConnection(false, error); }
      return json(res, 200, status());
    }
    return json(res, 404, { ok: false, message: 'Ruta Edge no encontrada' });
  } catch (error) {
    return json(res, 400, { ok: false, code: error.code || 'EDGE_LOCAL_ERROR', message: error.message || String(error) });
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`VantixGC Edge Agent escuchando en http://${HOST}:${PORT}`);
  recordEvent('EDGE_AGENT_STARTED', { port: PORT, host: HOST });
  try { await refreshBootstrap(true); } catch (error) { setConnection(false, error); }
  setInterval(async () => {
    try {
      await pingCore();
      if (store.pendingCount() > 0) await flushQueue();
      else await refreshBootstrap(false);
    } catch (error) {
      setConnection(false, error);
    }
  }, POLL_MS).unref();
});

function shutdown() {
  recordEvent('EDGE_AGENT_STOPPING', { pending: store.pendingCount() });
  try { store.close(); } finally { server.close(() => process.exit(0)); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
