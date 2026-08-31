'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EdgeStore } = require('./store');

const PORT = Number(process.env.EDGE_PORT || 8788);
const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const INSTALL_ROOT = process.env.EDGE_INSTALL_ROOT
  || (fs.existsSync(path.join(process.cwd(), 'agent', 'server.js')) ? process.cwd() : path.resolve(__dirname, '..'));
const DATA_DIR = process.env.EDGE_DATA_DIR || path.join(INSTALL_ROOT, 'data');
const DB_PATH = process.env.EDGE_DB_PATH || path.join(DATA_DIR, 'vantixgc-edge.sqlite');
const ASSET_PATH = path.join(__dirname, '..', 'workspace', 'public', 'offline-waiter-v2.js');
const ASSET = fs.readFileSync(ASSET_PATH, 'utf8');
const store = new EdgeStore(DB_PATH, LOCAL_KEY);

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(data);
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

function cookies(req) {
  const out = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
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

function readSession(req) {
  if (!LOCAL_KEY) return null;
  const raw = cookies(req).vantixgc_edge_workspace;
  if (!raw) return null;
  const [id, signature] = raw.split('.');
  if (!id || !signature || !safeEqual(signature, hmac(id))) return null;
  const row = store.getMeta(`workspace_session:${id}`);
  if (!row?.snapshot || Number(row.expiresAt || 0) <= Date.now()) return null;
  return row.snapshot;
}

function can(session, code) {
  const permissions = session?.permissions || [];
  return permissions.includes('*') || permissions.includes(code);
}

function requireWaiter(req, res) {
  const session = readSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'EDGE_WORKSPACE_SESSION_REQUIRED', message: 'Vincula este equipo con tu cuenta VantixGC.' });
    return null;
  }
  if (!can(session, 'PEDIDOS.CREAR')) {
    json(res, 403, { ok: false, code: 'EDGE_WORKSPACE_FORBIDDEN', message: 'Tu usuario no tiene permiso para crear pedidos.' });
    return null;
  }
  return session;
}

function restaurantState() {
  return store.getSnapshot('restaurant')?.payload || { tables: [], menu: [], commands: [], cashShifts: [] };
}

function saveRestaurantState(state) {
  store.putSnapshot('restaurant-local', String(Date.now()), state);
  store.putSnapshot('restaurant', `offline-waiter-${Date.now()}`, state);
}

function ledger() {
  return store.getSnapshot('workspace-ledger')?.payload || { tables: {}, closed: [] };
}

function saveLedger(value) {
  store.putSnapshot('workspace-ledger', `offline-waiter-${Date.now()}`, value);
}

function tableContext(tableId) {
  const state = restaurantState();
  const table = (state.tables || []).find((row) => row.id === tableId);
  if (!table) throw Object.assign(new Error('Mesa no disponible en el snapshot local'), { status: 404, code: 'EDGE_RESTAURANT_TABLE_NOT_FOUND' });
  if (!table.activeSession?.id) throw Object.assign(new Error('La mesa no tiene sesión abierta'), { status: 409, code: 'EDGE_RESTAURANT_SESSION_REQUIRED' });
  if (!table.activeSession.billingMode) table.activeSession.billingMode = 'CONJUNTA';
  table.activeSession.guestCount = Math.max(1, Number(table.activeSession.guestCount || 1));
  return { state, table, service: table.activeSession };
}

function draftKey(session, tableId) {
  return `offline_waiter_draft:${session.user.id}:${tableId}`;
}

function emptyDraft(sessionId) {
  return {
    sessionId,
    revision: 0,
    reviewedRevision: null,
    reviewedAt: null,
    items: [],
    updatedAt: new Date().toISOString()
  };
}

function getDraft(session, tableId, sessionId) {
  const key = draftKey(session, tableId);
  const current = store.getMeta(key);
  if (!current || current.sessionId !== sessionId) {
    const fresh = emptyDraft(sessionId);
    store.setMeta(key, fresh);
    return fresh;
  }
  return current;
}

function saveDraft(session, tableId, draft, changed = true) {
  const next = {
    ...draft,
    revision: changed ? Number(draft.revision || 0) + 1 : Number(draft.revision || 0),
    reviewedRevision: changed ? null : draft.reviewedRevision,
    reviewedAt: changed ? null : draft.reviewedAt,
    updatedAt: new Date().toISOString()
  };
  store.setMeta(draftKey(session, tableId), next);
  return next;
}

function lineTotal(menuItem, quantity) {
  const product = menuItem?.product || {};
  const subtotal = Number(product.precio1 || 0) * Number(quantity || 0);
  return Number((subtotal + subtotal * Number(product.ivaPct || 0) / 100 + subtotal * Number(product.impoconsumoPct || 0) / 100).toFixed(2));
}

function enrichedDraft(session, tableId) {
  const { table, service } = tableContext(tableId);
  const draft = getDraft(session, tableId, service.id);
  const menu = new Map((restaurantState().menu || []).map((row) => [row.id, row]));
  const items = draft.items.map((item) => {
    const row = menu.get(item.menuItemId);
    return {
      ...item,
      name: row?.product?.nombre || 'Producto',
      category: row?.category || null,
      station: row?.station || null,
      unitPrice: Number(row?.product?.precio1 || 0),
      lineTotal: lineTotal(row, item.quantity)
    };
  });
  return {
    table: { id: table.id, code: table.code, name: table.name, state: table.state },
    service: {
      id: service.id,
      billingMode: service.billingMode || 'CONJUNTA',
      guestCount: Math.max(1, Number(service.guestCount || 1))
    },
    draft: { ...draft, items, total: items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0) }
  };
}

function normalizeSeat(service, value) {
  if (service.billingMode !== 'INDIVIDUAL') return null;
  const seat = Number(value || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > Number(service.guestCount || 1)) {
    throw Object.assign(new Error('La persona seleccionada no pertenece a esta mesa'), { status: 400, code: 'EDGE_RESTAURANT_SEAT_INVALID' });
  }
  return seat;
}

function normalizeNote(value) {
  const text = String(value || '').trim();
  if (text.length > 500) throw Object.assign(new Error('La nota es demasiado larga'), { status: 400, code: 'EDGE_RESTAURANT_NOTE_TOO_LONG' });
  return text || null;
}

function setDraftLine(session, tableId, input) {
  const { table, service } = tableContext(tableId);
  const menuItem = (restaurantState().menu || []).find((row) => row.id === input.menuItemId && row.available !== false);
  if (!menuItem) throw Object.assign(new Error('Producto no disponible en el menú local'), { status: 400, code: 'EDGE_RESTAURANT_MENU_ITEM_INVALID' });
  const quantity = Number(input.quantity || 0);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) throw Object.assign(new Error('Cantidad inválida'), { status: 400, code: 'EDGE_RESTAURANT_QTY_INVALID' });
  const seatNumber = normalizeSeat(service, input.seatNumber);
  const notes = normalizeNote(input.notes);
  const draft = getDraft(session, tableId, service.id);
  const key = (row) => `${row.menuItemId}|${row.seatNumber || 0}`;
  const wanted = `${input.menuItemId}|${seatNumber || 0}`;
  const before = JSON.stringify(draft.items);
  const items = draft.items.filter((row) => key(row) !== wanted);
  if (quantity > 0) items.push({ menuItemId: input.menuItemId, quantity, seatNumber, notes });
  items.sort((a, b) => (Number(a.seatNumber || 0) - Number(b.seatNumber || 0)) || String(a.menuItemId).localeCompare(String(b.menuItemId)));
  const changed = before !== JSON.stringify(items);
  const saved = saveDraft(session, table.id, { ...draft, items }, changed);
  return enrichedDraft(session, tableId, saved);
}

function hasConfirmedLocalConsumption(tableId) {
  const row = ledger().tables?.[tableId];
  return Boolean(row && Array.isArray(row.orders) && row.orders.length);
}

function updateService(session, tableId, input) {
  const { state, table, service } = tableContext(tableId);
  const draft = getDraft(session, tableId, service.id);
  let billingMode = String(input.billingMode || service.billingMode || 'CONJUNTA').toUpperCase();
  if (!['CONJUNTA', 'INDIVIDUAL'].includes(billingMode)) throw Object.assign(new Error('Modo de cuenta inválido'), { status: 400, code: 'EDGE_RESTAURANT_BILLING_MODE_INVALID' });
  const guestCount = Math.max(1, Math.min(50, Number(input.guestCount ?? service.guestCount ?? 1)));
  if (!Number.isInteger(guestCount)) throw Object.assign(new Error('Número de personas inválido'), { status: 400, code: 'EDGE_RESTAURANT_GUEST_COUNT_INVALID' });
  const hasItems = draft.items.length > 0 || hasConfirmedLocalConsumption(tableId);
  if (billingMode !== service.billingMode && hasItems) {
    throw Object.assign(new Error('El modo de cuenta debe definirse antes de agregar productos.'), { status: 409, code: 'EDGE_RESTAURANT_BILLING_MODE_LOCKED' });
  }

  const previousGuestCount = Number(service.guestCount || 1);
  const changed = billingMode !== service.billingMode || guestCount !== previousGuestCount;
  if (!changed) return enrichedDraft(session, tableId);

  service.billingMode = billingMode;
  service.guestCount = guestCount;

  let nextItems = draft.items.map((item) => ({ ...item }));
  if (billingMode !== 'INDIVIDUAL') {
    nextItems = nextItems.map((item) => ({ ...item, seatNumber: null }));
  } else if (guestCount < previousGuestCount) {
    nextItems = nextItems.map((item) => ({ ...item, seatNumber: Number(item.seatNumber || 1) > guestCount ? guestCount : Number(item.seatNumber || 1) }));
    const combined = new Map();
    for (const item of nextItems) {
      const key = `${item.menuItemId}|${item.seatNumber || 0}`;
      const existing = combined.get(key);
      if (existing) existing.quantity += Number(item.quantity || 0);
      else combined.set(key, { ...item });
    }
    nextItems = [...combined.values()];
  }

  const book = ledger();
  const local = book.tables?.[tableId];
  if (local?.orders?.length) {
    for (const order of local.orders) {
      for (const line of order.lines || []) {
        if (billingMode !== 'INDIVIDUAL') line.seatNumber = null;
        else if (Number(line.seatNumber || 1) > guestCount) line.seatNumber = guestCount;
      }
    }
    saveLedger(book);
  }

  saveRestaurantState(state);
  saveDraft(session, table.id, { ...draft, items: nextItems }, true);
  return enrichedDraft(session, tableId);
}

function reviewDraft(session, tableId) {
  const { service } = tableContext(tableId);
  const draft = getDraft(session, tableId, service.id);
  if (!draft.items.length) throw Object.assign(new Error('Agrega al menos un producto antes de revisar.'), { status: 400, code: 'EDGE_RESTAURANT_DRAFT_EMPTY' });
  const reviewed = {
    ...draft,
    reviewedRevision: Number(draft.revision || 0),
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.setMeta(draftKey(session, tableId), reviewed);
  return enrichedDraft(session, tableId);
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

function recordConfirmedOrder(tableId, items) {
  const state = restaurantState();
  const menu = new Map((state.menu || []).map((row) => [row.id, row]));
  const book = ledger();
  if (!book.tables) book.tables = {};
  const row = book.tables[tableId] || { total: 0, orders: [] };
  const lines = items.map((item) => {
    const menuItem = menu.get(item.menuItemId);
    return {
      menuItemId: item.menuItemId,
      name: menuItem?.product?.nombre || 'Producto',
      quantity: Number(item.quantity || 0),
      station: menuItem?.station || null,
      seatNumber: item.seatNumber == null ? null : Number(item.seatNumber),
      notes: item.notes || null,
      lineTotal: lineTotal(menuItem, item.quantity)
    };
  });
  const total = lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
  row.total = Number((Number(row.total || 0) + total).toFixed(2));
  row.orders.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), lines, total });
  book.tables[tableId] = row;
  saveLedger(book);
  return row;
}

async function confirmDraft(session, tableId) {
  const { service } = tableContext(tableId);
  const draft = getDraft(session, tableId, service.id);
  if (!draft.items.length) throw Object.assign(new Error('No hay productos por confirmar.'), { status: 400, code: 'EDGE_RESTAURANT_DRAFT_EMPTY' });
  if (draft.reviewedRevision == null || Number(draft.reviewedRevision) !== Number(draft.revision)) {
    throw Object.assign(new Error('Revisa el pedido antes de confirmarlo. Cualquier cambio exige una nueva revisión.'), { status: 409, code: 'EDGE_RESTAURANT_REVIEW_REQUIRED' });
  }
  const items = draft.items.map((item) => ({
    menuItemId: item.menuItemId,
    quantity: Number(item.quantity),
    seatNumber: item.seatNumber,
    notes: item.notes || null,
    serviceBillingMode: service.billingMode || 'CONJUNTA',
    serviceGuestCount: Number(service.guestCount || 1)
  }));
  const result = await local('/api/restaurant/orders', {
    method: 'POST',
    body: JSON.stringify({ sessionId: service.id, items })
  });
  const bill = recordConfirmedOrder(tableId, items);
  store.setMeta(draftKey(session, tableId), emptyDraft(service.id));
  return { order: result.data, bill, reviewGate: 'CONFIRMED' };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/workspace/offline-waiter-v2.js') {
    const data = Buffer.from(ASSET);
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
    res.end(data);
    return true;
  }

  if (req.method === 'POST' && /^\/workspace\/api\/tables\/[^/]+\/orders$/.test(url.pathname)) {
    json(res, 409, { ok: false, code: 'EDGE_RESTAURANT_REVIEW_REQUIRED', message: 'En modo local no se puede enviar directo a Cocina. Usa REVISAR PEDIDO y luego CONFIRMAR PEDIDO.' });
    return true;
  }

  const match = url.pathname.match(/^\/workspace\/api\/offline-waiter\/tables\/([^/]+)(?:\/(service|line|review|confirm))?$/);
  if (!match) return false;
  const session = requireWaiter(req, res);
  if (!session) return true;
  const tableId = decodeURIComponent(match[1]);
  const action = match[2] || null;

  if (req.method === 'GET' && !action) {
    json(res, 200, { ok: true, data: enrichedDraft(session, tableId) });
    return true;
  }
  if (req.method === 'PUT' && action === 'service') {
    json(res, 200, { ok: true, data: updateService(session, tableId, await readJson(req)) });
    return true;
  }
  if (req.method === 'PUT' && action === 'line') {
    json(res, 200, { ok: true, data: setDraftLine(session, tableId, await readJson(req)) });
    return true;
  }
  if (req.method === 'POST' && action === 'review') {
    json(res, 200, { ok: true, data: reviewDraft(session, tableId) });
    return true;
  }
  if (req.method === 'POST' && action === 'confirm') {
    json(res, 201, { ok: true, data: await confirmDraft(session, tableId) });
    return true;
  }
  json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' });
  return true;
}

function injectScript(req, res, listener) {
  const originalWriteHead = res.writeHead;
  const originalEnd = res.end;
  res.writeHead = function patchedWriteHead(statusCode, statusMessage, headers) {
    if (typeof statusMessage === 'object' && statusMessage !== null) {
      const next = { ...statusMessage };
      delete next['Content-Length'];
      delete next['content-length'];
      return originalWriteHead.call(this, statusCode, next);
    }
    const next = headers ? { ...headers } : undefined;
    if (next) {
      delete next['Content-Length'];
      delete next['content-length'];
    }
    return originalWriteHead.call(this, statusCode, statusMessage, next);
  };
  res.end = function patchedEnd(chunk, encoding, callback) {
    if (chunk != null) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
      if (text.includes('</body>') && !text.includes('/workspace/offline-waiter-v2.js')) {
        chunk = text.replace('</body>', '<script src="/workspace/offline-waiter-v2.js"></script></body>');
        encoding = 'utf8';
      }
    }
    return originalEnd.call(this, chunk, encoding, callback);
  };
  return listener(req, res);
}

const originalCreateServer = http.createServer;
http.createServer = function offlineWaiterCreateServer(listener) {
  return originalCreateServer.call(http, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (await handleApi(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/app/centro-de-control') return injectScript(req, res, listener);
      return listener(req, res);
    } catch (error) {
      json(res, Number(error.status || 500), { ok: false, code: error.code || 'EDGE_OFFLINE_WAITER_ERROR', message: error.message || String(error) });
    }
  });
};

module.exports = { marker: 'EDGE_OFFLINE_WAITER_REVIEW_HARD_GATE_V2' };
