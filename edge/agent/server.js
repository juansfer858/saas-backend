const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { EdgeStore } = require('./store');
const { printJob } = require('../print-spooler/escpos');
const { startLanDiscovery, privateAddresses } = require('./lan-discovery');
const { EdgeUpdater } = require('../updater/updater');

const PORT = Number(process.env.EDGE_PORT || 8788);
const HOST = process.env.EDGE_HOST || '0.0.0.0';
const CORE_BASE_URL = String(process.env.CORE_BASE_URL || '').replace(/\/$/, '');
const EDGE_AGENT_ID = process.env.EDGE_AGENT_ID || '';
const EDGE_AGENT_KEY = process.env.EDGE_AGENT_KEY || '';
const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const LAN_KEY = process.env.EDGE_LAN_KEY || '';
const INSTALL_ROOT = process.env.EDGE_INSTALL_ROOT
  || (fs.existsSync(path.join(process.cwd(), 'agent', 'server.js')) ? process.cwd() : path.resolve(__dirname, '..'));
const DATA_DIR = process.env.EDGE_DATA_DIR || path.join(INSTALL_ROOT, 'data');
const DB_PATH = process.env.EDGE_DB_PATH || path.join(DATA_DIR, 'vantixgc-edge.sqlite');
const POLL_MS = Math.max(2000, Number(process.env.EDGE_SYNC_INTERVAL_MS || 5000));
const RETRY_BASE_MS = Math.max(500, Number(process.env.EDGE_RETRY_BASE_MS || 5000));
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const store = new EdgeStore(DB_PATH, LOCAL_KEY);
const installationId = store.getOrCreateInstallationId();

const runtime = {
  connected: false,
  revoked: false,
  syncing: false,
  lastOnlineAt: null,
  lastSyncAt: null,
  lastBootstrapAt: null,
  lastRestaurantBootstrapAt: null,
  lastError: null,
  relayConnected: false,
  updaterState: 'IDLE'
};

const REST_TYPES = new Set([
  'RESTAURANT_TABLE_OPEN',
  'RESTAURANT_ACCOUNT_REQUEST',
  'RESTAURANT_ORDER_CREATE',
  'RESTAURANT_COMMAND_STATUS',
  'RESTAURANT_CASH_OPEN',
  'RESTAURANT_CASH_CLOSE',
  'RESTAURANT_TABLE_CLOSE'
]);
const REMOTE_TERMINAL = new Set(['DELIVERED', 'PICKED_UP', 'REJECTED', 'CANCELED']);
const REMOTE_TRANSITIONS = Object.freeze({
  APPROVED: new Set(['PREPARING', 'CANCELED']),
  PREPARING: new Set(['READY', 'CANCELED']),
  READY: new Set(['IN_TRANSIT', 'DELIVERED', 'PICKED_UP', 'CANCELED']),
  IN_TRANSIT: new Set(['DELIVERED', 'CANCELED'])
});

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
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
  } else if (error) {
    runtime.lastError = error.message || String(error);
  }
  if (changed) recordEvent(connected ? 'CORE_CONNECTED' : 'CORE_DISCONNECTED', { error: error?.message || null, pending: store.pendingCount() });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Payload demasiado grande'), { status: 413, code: 'EDGE_PAYLOAD_TOO_LARGE' });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function central(pathname, options = {}) {
  const affectsConnection = options.affectsConnection !== false;
  if (!CORE_BASE_URL || !EDGE_AGENT_ID || !EDGE_AGENT_KEY) {
    throw Object.assign(new Error('Edge Agent no está provisionado contra un Core'), { code: 'EDGE_NOT_PROVISIONED' });
  }
  const requestOptions = { ...options };
  delete requestOptions.affectsConnection;
  let response;
  try {
    response = await fetch(`${CORE_BASE_URL}${pathname}`, {
      ...requestOptions,
      signal: AbortSignal.timeout(Number(process.env.EDGE_HTTP_TIMEOUT_MS || 5000)),
      headers: {
        'Content-Type': 'application/json',
        'x-vantix-edge-id': EDGE_AGENT_ID,
        'x-vantix-edge-key': EDGE_AGENT_KEY,
        ...(options.headers || {})
      }
    });
  } catch (error) {
    if (affectsConnection) setConnection(false, error);
    throw error;
  }
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = Object.assign(new Error(body?.error?.message || body?.message || `Core HTTP ${response.status}`), {
      status: response.status,
      code: body?.error?.code || `HTTP_${response.status}`
    });
    if ((response.status === 401 || response.status === 403) && affectsConnection) runtime.revoked = true;
    if (affectsConnection) setConnection(false, error);
    throw error;
  }
  if (affectsConnection) {
    runtime.revoked = false;
    setConnection(true);
  }
  return body;
}

const optional = (pathname, options = {}) => central(pathname, { ...options, affectsConnection: false });

async function pingCore() {
  try { await central('/edge/api/v1/ping'); return true; } catch { return false; }
}

async function refreshBootstrap(force = false) {
  const current = store.getSnapshot('bootstrap');
  const stale = !current || Date.now() - new Date(current.updatedAt).getTime() > 60000;
  if (!force && !stale) return current;
  const response = await central('/edge/api/v1/bootstrap');
  store.putSnapshot('bootstrap', response.data.snapshotVersion, response.data);
  if (store.pendingCount() === 0) store.resetStockDeltas();
  runtime.lastBootstrapAt = new Date().toISOString();
  recordEvent('BOOTSTRAP_SYNCED', {
    snapshotVersion: response.data.snapshotVersion,
    paymentPolicy: response.data.offlinePolicy?.paymentPolicy || 'CASH_ONLY'
  });
  return store.getSnapshot('bootstrap');
}

async function refreshRestaurantBootstrap(force = false) {
  const current = store.getSnapshot('restaurant');
  const stale = !current || Date.now() - new Date(current.updatedAt).getTime() > 15000;
  if (!force && !stale) return current;
  try {
    const response = await optional('/edge/api/v1/restaurant/bootstrap');
    const version = crypto.createHash('sha256').update(JSON.stringify(response.data)).digest('hex');
    store.putSnapshot('restaurant', version, response.data);
    runtime.lastRestaurantBootstrapAt = new Date().toISOString();
    return store.getSnapshot('restaurant');
  } catch (error) {
    if (error.status === 404) return current;
    throw error;
  }
}

async function flushQueue() {
  if (runtime.syncing || runtime.revoked) return;
  runtime.syncing = true;
  try {
    for (const operation of store.listPending(200)) {
      try {
        const endpoint = REST_TYPES.has(operation.type)
          ? '/edge/api/v1/sync/restaurant-operations'
          : '/edge/api/v1/sync/operations';
        const response = await central(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            operations: [{ id: operation.id, type: operation.type, localTimestamp: operation.localTimestamp, payload: operation.payload }]
          })
        });
        const result = response.data?.[0];
        if (result?.ok) {
          store.markSynced(operation.id, result.originDocumentId || null);
          recordEvent('OPERATION_SYNCED', {
            operationId: operation.id,
            type: operation.type,
            originDocumentId: result.originDocumentId || null
          });
        } else {
          const backoff = store.markFailed(operation.id, `${result?.code || 'EDGE_SYNC_FAILED'}: ${result?.message || 'Sin detalle'}`, RETRY_BASE_MS);
          recordEvent('OPERATION_SYNC_FAILED', { operationId: operation.id, type: operation.type, code: result?.code || 'EDGE_SYNC_FAILED', ...backoff });
        }
      } catch (error) {
        const backoff = store.markFailed(operation.id, `${error.code || 'NETWORK'}: ${error.message}`, RETRY_BASE_MS);
        recordEvent('OPERATION_SYNC_FAILED', { operationId: operation.id, type: operation.type, code: error.code || 'NETWORK', ...backoff });
        if (error.status === 401 || error.status === 403 || !error.status) break;
      }
    }
    if (store.pendingCount() === 0 && !runtime.revoked) {
      runtime.lastSyncAt = new Date().toISOString();
      try { await Promise.all([refreshBootstrap(true), refreshRestaurantBootstrap(true)]); } catch (error) { if (!error.status) setConnection(false, error); }
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
    products: (data.products || []).map((product) => ({
      ...product,
      stockCentralSnapshot: Number(product.stockActual || 0),
      stockLocal: Number(product.stockActual || 0) + store.stockDelta(product.id)
    }))
  };
}

function calculateSale(input) {
  const catalog = catalogWithLocalStock();
  if (!catalog) throw Object.assign(new Error('No existe catálogo sincronizado. Conecte este punto al menos una vez antes de operar offline.'), { code: 'EDGE_CATALOG_REQUIRED' });
  const products = new Map((catalog.products || []).map((product) => [product.id, product]));
  const recipes = new Map((catalog.recipes || []).filter((recipe) => recipe.outputProductId).map((recipe) => [recipe.outputProductId, recipe]));
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
    const lineImpoconsumo = Number((lineSubtotal * Number(product.impoconsumoPct || 0) / 100).toFixed(2));
    subtotal += lineSubtotal;
    iva += lineIva;
    impoconsumo += lineImpoconsumo;
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
        deltas.set(item.ingredientProductId, (deltas.get(item.ingredientProductId) || 0) - Number(item.quantity) * quantity);
      }
    } else if (product.controlaInventario) {
      deltas.set(product.id, (deltas.get(product.id) || 0) - quantity);
    }
  }
  if (!details.length) throw new Error('La venta requiere al menos una línea');
  return {
    catalog,
    details,
    deltas,
    subtotal: Number(subtotal.toFixed(2)),
    iva: Number(iva.toFixed(2)),
    impoconsumo: Number(impoconsumo.toFixed(2)),
    total: Number((subtotal + iva + impoconsumo).toFixed(2))
  };
}

function receiptPrintSpec(sale, calculation) {
  const bootstrap = calculation.catalog;
  const configured = (bootstrap.printers || []).find((printer) => printer.host && (printer.role === 'DOCUMENTOS' || printer.role === 'CAJA'));
  const host = process.env.EDGE_RECEIPT_PRINTER_HOST || configured?.host;
  if (!host) return null;
  const printer = {
    name: configured?.name || 'Ticket',
    host,
    port: Number(process.env.EDGE_RECEIPT_PRINTER_PORT || configured?.port || 9100)
  };
  const payment = sale.paymentMode === 'MANUAL_EXTERNAL_PENDING'
    ? 'PAGO EXTERNO: PENDIENTE DE CONFIRMAR'
    : `EFECTIVO: $${sale.cashReceived.toLocaleString('es-CO')}`;
  return {
    printer,
    payload: {
      title: bootstrap.tenant?.nombreEmpresa || 'VantixGC',
      lines: [
        `Punto: ${bootstrap.edge?.pointCode || ''}`,
        `Venta local: ${sale.localNumber}`,
        ...calculation.details.map((detail) => ({ quantity: detail.cantidad, name: `${detail.descripcion}  $${Number(detail.precioUnitario).toLocaleString('es-CO')}` })),
        `TOTAL: $${calculation.total.toLocaleString('es-CO')}`,
        payment
      ],
      footer: runtime.connected ? 'Conectado · sincronización automática' : `MODO OFFLINE · ${store.pendingCount()} pendiente(s)`
    }
  };
}

let printing = false;
async function flushPrintQueue() {
  if (printing) return;
  printing = true;
  try {
    for (const job of store.listPendingPrintJobs(20)) {
      try {
        const result = await printJob(job.printer, job.payload);
        if (!result?.ok) throw new Error(result?.error || result?.reason || 'PRINT_FAILED');
        store.markPrintSuccess(job.id);
        recordEvent('PRINT_SUCCEEDED', { printJobId: job.id, role: job.role });
      } catch (error) {
        store.markPrintFailed(job.id, error.message);
        recordEvent('PRINT_FAILED', { printJobId: job.id, role: job.role, error: error.message });
      }
    }
  } finally {
    printing = false;
  }
}

async function createLocalSale(input) {
  const calculation = calculateSale(input);
  const policy = calculation.catalog.offlinePolicy?.paymentPolicy || 'CASH_ONLY';
  const paymentMode = String(input.paymentMode || 'CASH').toUpperCase();
  if (!runtime.connected && policy === 'PAUSE_SALES') throw Object.assign(new Error('Sin conexión: este negocio configuró pausa de nuevas ventas hasta recuperar Internet.'), { code: 'EDGE_OFFLINE_SALES_PAUSED' });
  if (!runtime.connected && policy === 'CASH_ONLY' && paymentMode !== 'CASH') throw Object.assign(new Error('Sin conexión: solo se aceptan pagos en efectivo.'), { code: 'EDGE_OFFLINE_CASH_ONLY' });
  if (paymentMode === 'MANUAL_EXTERNAL_PENDING' && policy !== 'MANUAL_EXTERNAL_PENDING') throw Object.assign(new Error('El registro manual de datáfono/QR no está habilitado para este negocio.'), { code: 'EDGE_MANUAL_EXTERNAL_DISABLED' });
  if (!['CASH', 'MANUAL_EXTERNAL_PENDING'].includes(paymentMode)) throw Object.assign(new Error('Modo de cobro local no soportado.'), { code: 'EDGE_PAYMENT_MODE_INVALID' });
  if (policy === 'PAUSE_SALES' && !(await pingCore())) throw Object.assign(new Error('No se pudo confirmar conexión con el Core. Nuevas ventas están pausadas por configuración.'), { code: 'EDGE_OFFLINE_SALES_PAUSED' });
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
  for (const [productId, delta] of calculation.deltas) store.adjustStock(productId, delta);
  recordEvent('LOCAL_SALE_CREATED', { operationId, localNumber, total: calculation.total, paymentMode, paymentStatus, connectedAtCapture: runtime.connected, paymentPolicy: policy });
  const spec = receiptPrintSpec({ id: saleId, localNumber, cashReceived, paymentMode }, calculation);
  let print = { ok: false, skipped: true, reason: 'No hay impresora LAN configurada para ticket' };
  if (spec) {
    const printId = store.enqueuePrintJob({ role: 'DOCUMENTOS', ...spec });
    await flushPrintQueue();
    const queued = store.printQueueSummary(10).find((row) => row.id === printId);
    print = queued?.state === 'PRINTED' ? { ok: true, queued: true } : { ok: false, queued: true, error: queued?.lastError || null };
  }
  void flushQueue();
  return {
    id: saleId,
    operationId,
    localNumber,
    total: calculation.total,
    cashReceived,
    paymentMode,
    paymentStatus,
    change: manualExternal ? 0 : Number((cashReceived - calculation.total).toFixed(2)),
    print,
    mode: runtime.connected ? 'CONNECTED' : 'OFFLINE',
    pending: store.pendingCount(),
    policy
  };
}

function currentPolicy() {
  return catalogWithLocalStock()?.offlinePolicy || { paymentPolicy: 'CASH_ONLY', manualPaymentNote: null };
}

function restaurantState() {
  return store.getSnapshot('restaurant')?.payload || { tables: [], menu: [], commands: [], cashShifts: [] };
}

function saveRestaurantState(state) {
  store.putSnapshot('restaurant-local', String(Date.now()), state);
  store.putSnapshot('restaurant', `local-${Date.now()}`, state);
}

function queueRestaurant(type, payload) {
  const id = crypto.randomUUID();
  const localTimestamp = new Date().toISOString();
  store.enqueueOperation({ id, type, localTimestamp, payload });
  recordEvent('RESTAURANT_LOCAL_OPERATION', { id, type });
  void flushQueue();
  return { id, type, localTimestamp, payload };
}

function localTableOpen(tableId, input = {}) {
  const state = restaurantState();
  const table = (state.tables || []).find((row) => row.id === tableId);
  if (!table) throw Object.assign(new Error('Mesa no disponible en snapshot local'), { code: 'EDGE_RESTAURANT_TABLE_NOT_FOUND' });
  if (table.activeSession) throw Object.assign(new Error('La mesa ya tiene cuenta abierta localmente'), { code: 'EDGE_RESTAURANT_TABLE_ALREADY_OPEN' });
  const operation = queueRestaurant('RESTAURANT_TABLE_OPEN', {
    tableId,
    guestCount: Number(input.guestCount || 1),
    customerPhoneE164: input.customerPhoneE164 || null
  });
  table.state = 'OCUPADA';
  table.activeSession = { id: `local:${operation.id}`, localSessionOperationId: operation.id, state: 'ABIERTA', guestCount: Number(input.guestCount || 1) };
  saveRestaurantState(state);
  return { operation, table, session: table.activeSession };
}

function localOrder(input) {
  const state = restaurantState();
  const sessionId = String(input.sessionId || '');
  if (!sessionId) throw Object.assign(new Error('sessionId es obligatorio'), { code: 'EDGE_RESTAURANT_SESSION_REQUIRED' });
  const localSession = sessionId.startsWith('local:');
  const menu = new Map((state.menu || []).map((row) => [row.id, row]));
  const requestedItems = input.items || [];
  if (!requestedItems.length) throw new Error('El pedido requiere al menos un producto');
  for (const item of requestedItems) {
    const menuItem = menu.get(item.menuItemId);
    if (!menuItem?.available || Number(item.quantity || 0) <= 0) throw Object.assign(new Error('El pedido contiene un producto no disponible en el snapshot local'), { code: 'EDGE_RESTAURANT_MENU_ITEM_INVALID' });
  }
  const payload = {
    sessionId: localSession ? null : sessionId,
    localSessionOperationId: localSession ? sessionId.slice(6) : null,
    items: requestedItems,
    notes: input.notes || null,
    customerPhoneE164: input.customerPhoneE164 || null
  };
  const operation = queueRestaurant('RESTAURANT_ORDER_CREATE', payload);
  const byStation = new Map();
  for (const item of payload.items) {
    const menuItem = menu.get(item.menuItemId);
    if (!byStation.has(menuItem.station)) byStation.set(menuItem.station, []);
    byStation.get(menuItem.station).push({ description: menuItem.product?.nombre || 'Producto', quantity: Number(item.quantity), notes: item.notes || null });
  }
  for (const [station, items] of byStation) {
    state.commands.push({
      id: `local:${operation.id}:${station}`,
      localOrderOperationId: operation.id,
      remoteOrderId: input.remoteOrderId || null,
      station,
      state: 'PENDIENTE',
      createdAt: new Date().toISOString(),
      items
    });
  }
  saveRestaurantState(state);
  return { operation };
}

function aggregateRemoteKdsState(state, remoteOrderId) {
  const commands = (state.commands || []).filter((command) => command.remoteOrderId === remoteOrderId);
  if (!commands.length) return 'APPROVED';
  if (commands.every((command) => ['LISTA', 'ENTREGADA'].includes(command.state))) return 'READY';
  if (commands.some((command) => command.state === 'EN_PREPARACION')) return 'PREPARING';
  return 'APPROVED';
}

async function syncRemoteReports() {
  if (!runtime.connected || runtime.revoked) return;
  for (const remote of store.listPendingRemoteReports(100)) {
    try {
      let originDocumentId = remote.originDocumentId || null;
      const operation = remote.localOperationId ? store.operationResult(remote.localOperationId) : null;
      if (operation?.state === 'SYNCED' && operation.originDocumentId) originDocumentId = operation.originDocumentId;
      if (REMOTE_TERMINAL.has(remote.state) && operation && operation.state !== 'SYNCED') continue;
      const response = await optional(`/edge/api/v1/remote-orders/${remote.id}/report`, {
        method: 'POST',
        body: JSON.stringify({
          state: remote.state,
          localOperationId: remote.localOperationId || null,
          originDocumentId
        })
      });
      store.markRemoteReportSynced(remote.id, response.data || { state: remote.state, localOperationId: remote.localOperationId, originDocumentId });
      recordEvent('REMOTE_ORDER_REPORTED', { remoteOrderId: remote.id, state: remote.state, originDocumentId });
    } catch (error) {
      recordEvent('REMOTE_ORDER_REPORT_FAILED', { remoteOrderId: remote.id, state: remote.state, error: error.message });
      if (!error.status) break;
    }
  }
}

function addRemoteKdsCommands(remote) {
  const state = restaurantState();
  const existing = new Set((state.commands || []).filter((command) => command.remoteOrderId === remote.id).map((command) => command.station));
  const byStation = new Map();
  for (const item of remote.items || []) {
    if (!item.station || existing.has(item.station)) continue;
    if (!byStation.has(item.station)) byStation.set(item.station, []);
    byStation.get(item.station).push({ description: item.name || 'Producto', quantity: Number(item.quantity || 0), notes: item.notes || null });
  }
  for (const [station, items] of byStation) {
    state.commands.push({
      id: `remote:${remote.id}:${station}`,
      remoteOrderId: remote.id,
      channelType: remote.channelType,
      station,
      state: 'PENDIENTE',
      createdAt: new Date().toISOString(),
      table: null,
      items
    });
  }
  saveRestaurantState(state);
}

async function ingestRemoteOrder(order) {
  const local = store.upsertRemoteOrder(order);
  if (local.localOperationId) return local;
  if (order.channelType === 'MESA') {
    const tableId = order.channel?.tableId;
    const state = restaurantState();
    const table = (state.tables || []).find((row) => row.id === tableId);
    if (!table?.activeSession) {
      recordEvent('REMOTE_ORDER_WAITING_TABLE', { remoteOrderId: order.id, tableId: tableId || null });
      return local;
    }
    const created = localOrder({
      sessionId: table.activeSession.id,
      remoteOrderId: order.id,
      customerPhoneE164: order.customerPhone || null,
      notes: order.notes || null,
      items: (order.items || []).map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: item.notes || null }))
    });
    store.setRemoteOrderLocalState(order.id, 'APPROVED', { localOperationId: created.operation.id });
  } else {
    addRemoteKdsCommands(order);
    store.setRemoteOrderLocalState(order.id, 'APPROVED', { localOperationId: `remote:${order.id}` });
  }
  await syncRemoteReports();
  return store.getRemoteOrder(order.id);
}

async function pullRemote() {
  try {
    const response = await optional('/edge/api/v1/remote-orders/pull?limit=50');
    for (const order of response.data || []) await ingestRemoteOrder(order);
    await syncRemoteReports();
  } catch {}
}

async function localCommand(id, nextState) {
  const state = restaurantState();
  const command = (state.commands || []).find((row) => row.id === id);
  if (!command) throw new Error('Comanda local no encontrada');
  command.state = nextState;
  if (id.startsWith('remote:')) {
    const remoteState = aggregateRemoteKdsState(state, command.remoteOrderId);
    saveRestaurantState(state);
    store.setRemoteOrderLocalState(command.remoteOrderId, remoteState, { localOperationId: `remote:${command.remoteOrderId}` });
    void syncRemoteReports();
    return { remote: true, command, remoteOrder: store.getRemoteOrder(command.remoteOrderId) };
  }
  const payload = id.startsWith('local:')
    ? { localOrderOperationId: command.localOrderOperationId, station: command.station, state: nextState }
    : { commandId: id, state: nextState };
  const operation = queueRestaurant('RESTAURANT_COMMAND_STATUS', payload);
  if (command.remoteOrderId) {
    const remoteState = aggregateRemoteKdsState(state, command.remoteOrderId);
    store.setRemoteOrderLocalState(command.remoteOrderId, remoteState, { localOperationId: command.localOrderOperationId || null });
    void syncRemoteReports();
  }
  saveRestaurantState(state);
  return { operation, command };
}

async function localRemoteStatus(id, nextState, input = {}) {
  const remote = store.getRemoteOrder(id);
  if (!remote) throw Object.assign(new Error('Pedido remoto local no encontrado'), { code: 'EDGE_REMOTE_ORDER_NOT_FOUND' });
  const current = remote.state;
  if (nextState !== current && !REMOTE_TRANSITIONS[current]?.has(nextState)) {
    throw Object.assign(new Error(`Transición remota inválida ${current} → ${nextState}`), { code: 'EDGE_REMOTE_ORDER_TRANSITION_INVALID' });
  }
  let localOperationId = remote.localOperationId || null;
  if (['DELIVERED', 'PICKED_UP'].includes(nextState) && remote.channelType !== 'MESA' && (!localOperationId || localOperationId.startsWith('remote:'))) {
    const sale = await createLocalSale({
      lines: (remote.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity })),
      paymentMode: remote.paymentMode || 'CASH',
      cashReceived: Number(input.cashReceived ?? remote.quotedTotal ?? 0)
    });
    localOperationId = sale.operationId;
  }
  const updated = store.setRemoteOrderLocalState(id, nextState, { localOperationId });
  void syncRemoteReports();
  return updated;
}

function softwareVersion() {
  for (const file of [path.join(INSTALL_ROOT, 'current', 'version.json'), path.join(INSTALL_ROOT, 'version.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed.version) return String(parsed.version);
    } catch {}
  }
  return process.env.EDGE_VERSION || 'dev';
}

function status() {
  return {
    ok: true,
    mode: runtime.connected && !runtime.revoked ? 'CONNECTED' : 'OFFLINE',
    connected: runtime.connected && !runtime.revoked,
    revoked: runtime.revoked,
    pending: store.pendingCount(),
    printPending: store.listPendingPrintJobs(1000).length,
    remoteReportPending: store.listPendingRemoteReports(1000).length,
    syncing: runtime.syncing,
    lastOnlineAt: runtime.lastOnlineAt,
    lastSyncAt: runtime.lastSyncAt,
    lastBootstrapAt: runtime.lastBootstrapAt,
    lastRestaurantBootstrapAt: runtime.lastRestaurantBootstrapAt,
    lastError: runtime.lastError,
    provisioned: Boolean(CORE_BASE_URL && EDGE_AGENT_ID && EDGE_AGENT_KEY),
    dbEncryptedPayloads: true,
    offlinePolicy: currentPolicy(),
    installationId,
    softwareVersion: softwareVersion(),
    lan: { host: HOST, port: PORT, addresses: privateAddresses(), writeProtection: LAN_KEY ? 'PAIRED_KEY' : 'LOOPBACK_ONLY' },
    relayConnected: runtime.relayConnected,
    updaterState: runtime.updaterState
  };
}

function fieldEvidence() {
  const bootstrap = store.getSnapshot('bootstrap');
  return {
    generatedAt: new Date().toISOString(),
    installationId,
    point: bootstrap?.payload?.edge ? { id: bootstrap.payload.edge.id, pointCode: bootstrap.payload.edge.pointCode, name: bootstrap.payload.edge.name } : null,
    tenant: bootstrap?.payload?.tenant ? { id: bootstrap.payload.tenant.id, nombreEmpresa: bootstrap.payload.tenant.nombreEmpresa } : null,
    status: status(),
    operations: store.pendingSummary(200),
    printQueue: store.printQueueSummary(200),
    remoteOrders: store.listRemoteOrders(100),
    recentSales: store.recentSales(100).map((sale) => ({
      id: sale.id,
      operationId: sale.operationId,
      localNumber: sale.localNumber,
      total: sale.total,
      paymentMode: sale.paymentMode,
      paymentStatus: sale.paymentStatus,
      createdAt: sale.createdAt
    })),
    events: store.recentEvents(300)
  };
}

function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function timingSafeTextEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function requireLanWrite(req) {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return;
  if (!LAN_KEY) {
    throw Object.assign(new Error('Las escrituras LAN están bloqueadas hasta configurar EDGE_LAN_KEY'), { status: 503, code: 'EDGE_LAN_KEY_REQUIRED' });
  }
  if (!timingSafeTextEqual(req.headers['x-vantix-lan-key'], LAN_KEY)) {
    throw Object.assign(new Error('Clave LAN inválida'), { status: 401, code: 'EDGE_LAN_AUTH_REQUIRED' });
  }
}

const updater = new EdgeUpdater({
  central,
  store,
  appRoot: INSTALL_ROOT,
  dataDir: DATA_DIR,
  enabled: process.env.EDGE_AUTO_UPDATE_ENABLED === 'true'
});

async function heartbeat() {
  try {
    await optional('/edge/api/v1/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        installationId,
        deviceName: os.hostname(),
        os: `${os.platform()} ${os.release()}`,
        architecture: os.arch(),
        lanHost: privateAddresses()[0] || null,
        lanPort: PORT,
        softwareVersion: softwareVersion(),
        healthStatus: 'OK',
        health: {
          pending: store.pendingCount(),
          printPending: store.listPendingPrintJobs(1000).length,
          remoteReportPending: store.listPendingRemoteReports(1000).length
        },
        relayConnected: runtime.relayConnected,
        updaterState: runtime.updaterState
      })
    });
  } catch {}
}

async function relayLoop() {
  try {
    const response = await optional('/edge/api/v1/relay/pull?limit=20');
    runtime.relayConnected = true;
    for (const request of response.data || []) {
      let result;
      try {
        if (request.action === 'STATUS') result = status();
        else if (request.action === 'SYNC_NOW') { await flushQueue(); await syncRemoteReports(); result = status(); }
        else if (request.action === 'CATALOG') result = { snapshot: store.getSnapshot('bootstrap')?.version || null, products: catalogWithLocalStock()?.products?.length || 0 };
        else if (request.action === 'PRINT_QUEUE') result = { jobs: store.printQueueSummary(100) };
        else if (request.action === 'REMOTE_ORDERS') result = { orders: store.listRemoteOrders(100) };
        else if (request.action === 'UPDATE_CHECK') result = await updater.checkNow();
        else throw new Error('Acción Relay local no soportada');
        await optional(`/edge/api/v1/relay/${request.id}/complete`, { method: 'POST', body: JSON.stringify({ ok: true, response: result }) });
      } catch (error) {
        await optional(`/edge/api/v1/relay/${request.id}/complete`, {
          method: 'POST',
          body: JSON.stringify({ ok: false, errorCode: error.code || 'EDGE_RELAY_LOCAL_ERROR', errorMessage: error.message })
        }).catch(() => {});
      }
    }
  } catch {
    runtime.relayConnected = false;
  }
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
    if (req.method === 'GET' && url.pathname === '/api/discovery') return json(res, 200, { ok: true, protocol: 'VANTIXGC_EDGE_DISCOVERY_V1', installationId, pointCode: catalogWithLocalStock()?.edge?.pointCode || null, httpPort: PORT, addresses: privateAddresses() });
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      const data = catalogWithLocalStock();
      return data ? json(res, 200, { ok: true, data }) : json(res, 503, { ok: false, message: 'Catálogo local no inicializado' });
    }
    if (req.method === 'GET' && url.pathname === '/api/restaurant') return json(res, 200, { ok: true, data: restaurantState() });
    if (req.method === 'GET' && url.pathname === '/api/remote-orders') return json(res, 200, { ok: true, data: store.listRemoteOrders(100) });
    if (req.method === 'GET' && url.pathname === '/api/print-queue') return json(res, 200, { ok: true, data: store.printQueueSummary(100) });
    if (req.method === 'GET' && url.pathname === '/api/sales/recent') return json(res, 200, { ok: true, data: store.recentSales(50) });
    if (req.method === 'GET' && url.pathname === '/api/field-evidence') return json(res, 200, { ok: true, data: fieldEvidence() });

    if (req.method !== 'GET' && url.pathname.startsWith('/api/')) requireLanWrite(req);

    if (req.method === 'POST' && url.pathname === '/api/sales') return json(res, 201, { ok: true, data: await createLocalSale(await readJson(req)) });
    let match;
    if (req.method === 'POST' && (match = url.pathname.match(/^\/api\/restaurant\/tables\/([^/]+)\/open$/))) {
      return json(res, 201, { ok: true, data: localTableOpen(match[1], await readJson(req)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/restaurant/orders') return json(res, 201, { ok: true, data: localOrder(await readJson(req)) });
    if (req.method === 'PATCH' && (match = url.pathname.match(/^\/api\/restaurant\/commands\/([^/]+)$/))) {
      return json(res, 200, { ok: true, data: await localCommand(decodeURIComponent(match[1]), (await readJson(req)).state) });
    }
    if (req.method === 'PATCH' && (match = url.pathname.match(/^\/api\/remote-orders\/([^/]+)$/))) {
      const input = await readJson(req);
      return json(res, 200, { ok: true, data: await localRemoteStatus(decodeURIComponent(match[1]), String(input.state || '').toUpperCase(), input) });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync-now') {
      try {
        await flushQueue();
        await Promise.all([refreshBootstrap(true), refreshRestaurantBootstrap(true)]);
        await flushPrintQueue();
        await syncRemoteReports();
      } catch (error) { if (!error.status) setConnection(false, error); }
      return json(res, 200, status());
    }
    if (req.method === 'POST' && url.pathname === '/api/update-check') {
      try {
        runtime.updaterState = 'CHECKING';
        const data = await updater.checkNow();
        runtime.updaterState = data?.restartScheduled ? 'RESTART_PENDING' : 'IDLE';
        return json(res, 200, { ok: true, data });
      } catch (error) {
        runtime.updaterState = 'FAILED';
        throw error;
      }
    }
    return json(res, 404, { ok: false, message: 'Ruta Edge no encontrada' });
  } catch (error) {
    return json(res, Number(error.status || 400), { ok: false, code: error.code || 'EDGE_LOCAL_ERROR', message: error.message || String(error) });
  }
});

let discovery = null;
server.listen(PORT, HOST, async () => {
  console.log(`VantixGC Edge Agent escuchando en http://${HOST}:${PORT}`);
  recordEvent('EDGE_AGENT_STARTED', { port: PORT, host: HOST, installationId, softwareVersion: softwareVersion() });
  discovery = startLanDiscovery({
    installationId,
    pointCode: process.env.EDGE_POINT_CODE || null,
    httpPort: PORT,
    onError: (error) => recordEvent('LAN_DISCOVERY_ERROR', { error: error.message })
  });
  try { await Promise.all([refreshBootstrap(true), refreshRestaurantBootstrap(true)]); } catch (error) { if (!error.status) setConnection(false, error); }
  setInterval(async () => {
    try {
      await pingCore();
      if (store.pendingCount() > 0) await flushQueue();
      else await Promise.all([refreshBootstrap(false), refreshRestaurantBootstrap(false)]);
      await flushPrintQueue();
      await syncRemoteReports();
    } catch (error) { setConnection(false, error); }
  }, POLL_MS).unref();
  setInterval(heartbeat, 15000).unref();
  setInterval(relayLoop, 3000).unref();
  setInterval(pullRemote, 5000).unref();
  if (process.env.EDGE_AUTO_UPDATE_ENABLED === 'true') {
    setInterval(() => updater.checkNow().catch((error) => recordEvent('UPDATE_FAILED', { error: error.message })), Math.max(60000, Number(process.env.EDGE_UPDATE_INTERVAL_MS || 60000))).unref();
  }
});

function shutdown() {
  recordEvent('EDGE_AGENT_STOPPING', { pending: store.pendingCount() });
  try { discovery?.close(); } catch {}
  try { store.close(); } finally { server.close(() => process.exit(0)); }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
