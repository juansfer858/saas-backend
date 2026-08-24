const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.EDGE_PORT || 8788);
const CORE_BASE_URL = String(process.env.CORE_BASE_URL || '').replace(/\/$/, '');
const EDGE_AGENT_ID = process.env.EDGE_AGENT_ID || '';
const EDGE_AGENT_KEY = process.env.EDGE_AGENT_KEY || '';
const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const WORKSPACE_SESSION_MS = Math.max(3600000, Number(process.env.EDGE_WORKSPACE_SESSION_MS || 7 * 24 * 60 * 60 * 1000));
const WORKSPACE_HTML = fs.readFileSync(path.join(__dirname, '..', 'workspace', 'public', 'index.html'), 'utf8');

const storeModule = require('./store');
const OriginalEdgeStore = storeModule.EdgeStore;
let storeInstance = null;
storeModule.EdgeStore = class WorkspaceEdgeStore extends OriginalEdgeStore {
  constructor(...args) {
    super(...args);
    storeInstance = this;
  }
};

function json(res, status, body, extra = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Payload demasiado grande'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function cookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

function hmac(value) {
  return crypto.createHmac('sha256', `${LOCAL_KEY}|vantixgc-edge-workspace-v1`).update(String(value)).digest('base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function createSession(snapshot) {
  if (!storeInstance || !LOCAL_KEY) throw Object.assign(new Error('Workspace local aún no está listo'), { status: 503, code: 'EDGE_WORKSPACE_NOT_READY' });
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + WORKSPACE_SESSION_MS;
  storeInstance.setMeta(`workspace_session:${id}`, { snapshot, expiresAt });
  return `${id}.${hmac(id)}`;
}

function readSession(req) {
  if (!storeInstance || !LOCAL_KEY) return null;
  const raw = cookies(req).vantixgc_edge_workspace;
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig || !safeEqual(sig, hmac(id))) return null;
  const row = storeInstance.getMeta(`workspace_session:${id}`);
  if (!row?.snapshot || Number(row.expiresAt || 0) <= Date.now()) return null;
  return row.snapshot;
}

function can(session, code) {
  const permissions = session?.permissions || [];
  return permissions.includes('*') || permissions.includes(code);
}

async function central(pathname, options = {}) {
  if (!CORE_BASE_URL || !EDGE_AGENT_ID || !EDGE_AGENT_KEY) throw Object.assign(new Error('Edge no provisionado'), { status: 503 });
  const response = await fetch(`${CORE_BASE_URL}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(Number(process.env.EDGE_HTTP_TIMEOUT_MS || 7000)),
    headers: {
      'Content-Type': 'application/json',
      'x-vantix-edge-id': EDGE_AGENT_ID,
      'x-vantix-edge-key': EDGE_AGENT_KEY,
      ...(options.headers || {})
    }
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || body?.message || `Core HTTP ${response.status}`), { status: response.status, code: body?.error?.code });
  return body;
}

async function local(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(body?.message || body?.error?.message || `Local HTTP ${response.status}`), { status: response.status, code: body?.code });
  return body;
}

function restaurantSnapshot() {
  return storeInstance?.getSnapshot('restaurant')?.payload || { tables: [], menu: [], commands: [], cashShifts: [] };
}

function saveRestaurantSnapshot(state) {
  if (!storeInstance) throw Object.assign(new Error('SQLite local no disponible'), { status: 503 });
  storeInstance.putSnapshot('restaurant', `workspace-${Date.now()}`, state);
}

function catalogSnapshot() {
  return storeInstance?.getSnapshot('bootstrap')?.payload || null;
}

function ledger() {
  return storeInstance?.getSnapshot('workspace-ledger')?.payload || { tables: {}, closed: [] };
}

function saveLedger(value) {
  storeInstance.putSnapshot('workspace-ledger', `workspace-${Date.now()}`, value);
}

function queue(type, payload) {
  const id = crypto.randomUUID();
  storeInstance.enqueueOperation({ id, type, localTimestamp: new Date().toISOString(), payload });
  return { id, type };
}

function menuLineTotal(menuItem, quantity) {
  const product = menuItem?.product || {};
  const subtotal = Number(product.precio1 || 0) * Number(quantity || 0);
  return subtotal + subtotal * Number(product.ivaPct || 0) / 100 + subtotal * Number(product.impoconsumoPct || 0) / 100;
}

function recordOrder(tableId, items) {
  const state = restaurantSnapshot();
  const menu = new Map((state.menu || []).map((x) => [x.id, x]));
  const book = ledger();
  const row = book.tables[tableId] || { total: 0, orders: [] };
  const lines = items.map((item) => {
    const menuItem = menu.get(item.menuItemId);
    return {
      menuItemId: item.menuItemId,
      name: menuItem?.product?.nombre || 'Producto',
      quantity: Number(item.quantity || 0),
      station: menuItem?.station || null,
      lineTotal: Number(menuLineTotal(menuItem, item.quantity).toFixed(2))
    };
  });
  const total = lines.reduce((sum, x) => sum + x.lineTotal, 0);
  row.total = Number((Number(row.total || 0) + total).toFixed(2));
  row.orders.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), lines, total });
  book.tables[tableId] = row;
  saveLedger(book);
  return row;
}

function clearTableLedger(tableId, payment) {
  const book = ledger();
  const current = book.tables[tableId] || { total: 0, orders: [] };
  book.closed.unshift({ tableId, total: Number(current.total || 0), payment, closedAt: new Date().toISOString() });
  book.closed = book.closed.slice(0, 100);
  delete book.tables[tableId];
  saveLedger(book);
  return current;
}

function workspaceState(session) {
  const restaurant = restaurantSnapshot();
  const catalog = catalogSnapshot();
  const book = ledger();
  const status = {
    pending: storeInstance?.pendingCount() || 0,
    printPending: storeInstance?.listPendingPrintJobs(1000).length || 0
  };
  return {
    session,
    restaurant,
    catalog,
    ledger: book,
    local: status,
    permissions: session?.permissions || []
  };
}

function requireSession(req, res, permission = null) {
  const session = readSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'EDGE_WORKSPACE_SESSION_REQUIRED', message: 'Vincula este equipo con tu cuenta VantixGC.' });
    return null;
  }
  if (permission && !can(session, permission)) {
    json(res, 403, { ok: false, code: 'EDGE_WORKSPACE_FORBIDDEN', message: 'Tu usuario no tiene permiso para esta acción.' });
    return null;
  }
  return session;
}

async function handleApi(req, res, url) {
  let session;
  if (req.method === 'GET' && url.pathname === '/workspace/api/me') {
    session = requireSession(req, res);
    if (!session) return true;
    json(res, 200, { ok: true, data: session });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/workspace/api/state') {
    session = requireSession(req, res, 'RESTAURANTE.VER');
    if (!session) return true;
    let live = null;
    try { live = (await local('/api/status')).connected; } catch {}
    json(res, 200, { ok: true, data: { ...workspaceState(session), connected: Boolean(live) } });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/workspace/api/sync') {
    session = requireSession(req, res, 'RESTAURANTE.VER');
    if (!session) return true;
    const result = await local('/api/sync-now', { method: 'POST', body: '{}' });
    json(res, 200, { ok: true, data: result });
    return true;
  }

  let match;
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/tables\/([^/]+)\/open$/))) {
    session = requireSession(req, res, 'MESAS.CREAR');
    if (!session) return true;
    const body = await readJson(req);
    const result = await local(`/api/restaurant/tables/${encodeURIComponent(match[1])}/open`, { method: 'POST', body: JSON.stringify({ guestCount: Number(body.guestCount || 1) }) });
    json(res, 201, { ok: true, data: result.data });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/tables\/([^/]+)\/account$/))) {
    session = requireSession(req, res, 'MESAS.EDITAR');
    if (!session) return true;
    const tableId = decodeURIComponent(match[1]);
    const op = queue('RESTAURANT_ACCOUNT_REQUEST', { tableId });
    const state = restaurantSnapshot();
    const table = (state.tables || []).find((x) => x.id === tableId);
    if (table) table.state = 'CUENTA_PEDIDA';
    saveRestaurantSnapshot(state);
    json(res, 200, { ok: true, data: { operation: op, table } });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/tables\/([^/]+)\/orders$/))) {
    session = requireSession(req, res, 'PEDIDOS.CREAR');
    if (!session) return true;
    const tableId = decodeURIComponent(match[1]);
    const body = await readJson(req);
    const state = restaurantSnapshot();
    const table = (state.tables || []).find((x) => x.id === tableId);
    if (!table?.activeSession?.id) throw Object.assign(new Error('La mesa no tiene sesión abierta'), { status: 409 });
    const items = Array.isArray(body.items) ? body.items.filter((x) => x.menuItemId && Number(x.quantity) > 0) : [];
    if (!items.length) throw Object.assign(new Error('Agrega al menos un producto'), { status: 400 });
    const result = await local('/api/restaurant/orders', { method: 'POST', body: JSON.stringify({ sessionId: table.activeSession.id, items, notes: body.notes || null }) });
    const bill = recordOrder(tableId, items);
    json(res, 201, { ok: true, data: { ...result.data, bill } });
    return true;
  }
  if (req.method === 'PATCH' && (match = url.pathname.match(/^\/workspace\/api\/commands\/(.+)$/))) {
    session = requireSession(req, res, 'COMANDAS.EDITAR');
    if (!session) return true;
    const body = await readJson(req);
    const result = await local(`/api/restaurant/commands/${encodeURIComponent(decodeURIComponent(match[1]))}`, { method: 'PATCH', body: JSON.stringify({ state: body.state }) });
    json(res, 200, { ok: true, data: result.data });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/tables\/([^/]+)\/close$/))) {
    session = requireSession(req, res, 'RESTAURANTE.CERRAR');
    if (!session) return true;
    const tableId = decodeURIComponent(match[1]);
    const body = await readJson(req);
    const catalog = catalogSnapshot();
    const payment = {
      formaPago: String(body.formaPago || 'EFECTIVO').toUpperCase(),
      cajaBancoId: body.cajaBancoId || catalog?.edge?.defaultCashAccountId || null,
      tipAmount: Number(body.tipAmount || 0),
      split: body.split || { mode: 'NONE' }
    };
    const op = queue('RESTAURANT_TABLE_CLOSE', { tableId, ...payment });
    const state = restaurantSnapshot();
    const table = (state.tables || []).find((x) => x.id === tableId);
    if (table) { table.state = 'LIBRE'; table.activeSession = null; }
    saveRestaurantSnapshot(state);
    const bill = clearTableLedger(tableId, payment);
    json(res, 200, { ok: true, data: { operation: op, table, bill } });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/workspace/api/cash/open') {
    session = requireSession(req, res, 'TESORERIA.CREAR');
    if (!session) return true;
    const body = await readJson(req);
    const catalog = catalogSnapshot();
    const cajaBancoId = body.cajaBancoId || catalog?.edge?.defaultCashAccountId || null;
    if (!cajaBancoId) throw Object.assign(new Error('No hay caja local configurada'), { status: 409 });
    const op = queue('RESTAURANT_CASH_OPEN', { cajaBancoId, saldoInicial: Number(body.saldoInicial || 0) });
    const state = restaurantSnapshot();
    const shift = { id: `local:${op.id}`, localShiftOperationId: op.id, cajaBancoId, userId: session.user.id, estado: 'ABIERTA', saldoInicial: Number(body.saldoInicial || 0), abiertoEn: new Date().toISOString() };
    state.cashShifts = [...(state.cashShifts || []).filter((x) => x.userId !== session.user.id || x.estado !== 'ABIERTA'), shift];
    saveRestaurantSnapshot(state);
    json(res, 201, { ok: true, data: shift });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/cash\/([^/]+)\/close$/))) {
    session = requireSession(req, res, 'TESORERIA.CERRAR');
    if (!session) return true;
    const body = await readJson(req);
    const shiftId = decodeURIComponent(match[1]);
    const localShift = shiftId.startsWith('local:');
    const op = queue('RESTAURANT_CASH_CLOSE', {
      shiftId: localShift ? null : shiftId,
      localShiftOperationId: localShift ? shiftId.slice(6) : null,
      saldoFinal: Number(body.saldoFinal || 0)
    });
    const state = restaurantSnapshot();
    state.cashShifts = (state.cashShifts || []).filter((x) => x.id !== shiftId);
    saveRestaurantSnapshot(state);
    json(res, 200, { ok: true, data: { operation: op, shiftId, saldoFinal: Number(body.saldoFinal || 0) } });
    return true;
  }
  return false;
}

function landing(req) {
  const host = String(req.headers.host || `127.0.0.1:${PORT}`);
  const localOrigin = `http://${host}`;
  const cloud = `${CORE_BASE_URL || 'https://core.vantixgc.com'}/app/centro-de-control?edge=${encodeURIComponent(EDGE_AGENT_ID)}&return=${encodeURIComponent(localOrigin)}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VantixGC Restaurantes</title><style>body{font-family:Inter,system-ui,sans-serif;background:#f4f4f5;color:#18221d;margin:0}.wrap{max-width:680px;margin:8vh auto;padding:20px}.card{background:white;border:1px solid #e4e4e7;border-radius:20px;padding:28px}.brand{color:#0d6b43;font-weight:900}.btn{display:inline-block;margin-top:14px;background:#0d6b43;color:white;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:800}.muted{color:#61706a}</style></head><body><div class="wrap"><div class="card"><div class="brand">VantixGC Restaurantes</div><h1>Centro de Control de esta sede</h1><p class="muted">Este equipo está conectado al servidor local VantixGC Edge. Vincúlalo una vez con tu cuenta VantixGC para trabajar desde la sede, incluso durante una caída de Internet.</p><a class="btn" href="${cloud}">Vincular con mi cuenta VantixGC</a><p class="muted">Punto Edge: ${EDGE_AGENT_ID || 'sin provisionar'}</p></div></div></body></html>`;
}

async function workspaceHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/edge-pos') {
      req.url = '/';
      return false;
    }
    if (req.method === 'GET' && url.pathname === '/access') {
      const grant = url.searchParams.get('grant');
      if (!grant) return redirect(res, '/');
      const response = await central('/edge/api/v1/local-access/consume', { method: 'POST', body: JSON.stringify({ token: grant }) });
      const session = createSession(response.data);
      return redirect(res, '/app/centro-de-control', {
        'Set-Cookie': `vantixgc_edge_workspace=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(WORKSPACE_SESSION_MS / 1000)}`
      });
    }
    if (req.method === 'POST' && url.pathname === '/workspace/logout') {
      return redirect(res, '/', { 'Set-Cookie': 'vantixgc_edge_workspace=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    }
    if (url.pathname.startsWith('/workspace/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' && url.pathname === '/app/centro-de-control') {
      if (!readSession(req)) return redirect(res, '/');
      const data = Buffer.from(WORKSPACE_HTML);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      res.end(data);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (readSession(req)) return redirect(res, '/app/centro-de-control');
      const body = Buffer.from(landing(req));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
      return true;
    }
    return false;
  } catch (error) {
    json(res, Number(error.status || 500), { ok: false, code: error.code || 'EDGE_WORKSPACE_ERROR', message: error.message || String(error) });
    return true;
  }
}

const originalCreateServer = http.createServer;
http.createServer = function patchedCreateServer(listener) {
  return originalCreateServer.call(http, async (req, res) => {
    const handled = await workspaceHandler(req, res);
    if (!handled) return listener(req, res);
  });
};

require('./server');
