'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const storeModule = require('./store');

const CORE_BASE_URL = String(process.env.CORE_BASE_URL || '').replace(/\/$/, '');
const EDGE_AGENT_ID = process.env.EDGE_AGENT_ID || '';
const EDGE_AGENT_KEY = process.env.EDGE_AGENT_KEY || '';
const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const INSTALL_ROOT = process.env.EDGE_INSTALL_ROOT
  || (fs.existsSync(path.join(process.cwd(), 'agent', 'server.js')) ? process.cwd() : path.resolve(__dirname, '..'));
const MATERIAL_REFRESH_MS = 60_000;

const OriginalEdgeStore = storeModule.EdgeStore;
let storeInstance = null;
let materialFetchInFlight = false;
let lastMaterialFetchAt = 0;

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', `${LOCAL_KEY}|vantixgc-edge-workspace-v1`).update(String(value)).digest('base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
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

function readWorkspaceSession(req) {
  if (!storeInstance || !LOCAL_KEY) return null;
  const raw = cookies(req).vantixgc_edge_workspace;
  if (!raw) return null;
  const [id, signature] = raw.split('.');
  if (!id || !signature || !safeEqual(signature, hmac(id))) return null;
  const row = storeInstance.getMeta(`workspace_session:${id}`);
  if (!row?.snapshot || Number(row.expiresAt || 0) <= Date.now()) return null;
  return row.snapshot;
}

function can(session, code) {
  const permissions = session?.permissions || [];
  return permissions.includes('*') || permissions.includes(code);
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-VantixGC-Edge-QR': 'wan-zero-v19'
  });
  res.end(data);
}

function edgeError(status, code, message, details = null) {
  return Object.assign(new Error(message), { status, code, details });
}

function requireWaiter(req) {
  const session = readWorkspaceSession(req);
  if (!session) throw edgeError(401, 'EDGE_WORKSPACE_SESSION_REQUIRED', 'Vincula este equipo con tu cuenta VantixGC.');
  if (!can(session, 'PEDIDOS.CREAR')) throw edgeError(403, 'EDGE_WORKSPACE_FORBIDDEN', 'Tu usuario no tiene permiso para crear pedidos.');
  return session;
}

function restaurantState() {
  return storeInstance?.getSnapshot('restaurant')?.payload || { tables: [], menu: [], commands: [], cashShifts: [] };
}

function saveRestaurantState(state) {
  if (!storeInstance) throw edgeError(503, 'EDGE_WAN_ZERO_NOT_READY', 'SQLite local aún no está listo');
  storeInstance.putSnapshot('restaurant-local', String(Date.now()), state);
  storeInstance.putSnapshot('restaurant', `wan-zero-v19-${Date.now()}`, state);
}

function tableContext(tableId) {
  const state = restaurantState();
  const table = (state.tables || []).find((row) => row.id === tableId);
  if (!table) throw edgeError(404, 'EDGE_RESTAURANT_TABLE_NOT_FOUND', 'Mesa no disponible en el snapshot local');
  const session = table.activeSession;
  if (!session?.id) throw edgeError(409, 'EDGE_RESTAURANT_SESSION_REQUIRED', 'La mesa debe estar abierta para activar autopedido');
  if (session.state !== 'ABIERTA') throw edgeError(409, 'EDGE_QR_ACCOUNT_LOCKED', 'La cuenta ya está en proceso de cierre');
  return { state, table, session };
}

function newVisitCode(previous = null) {
  let code;
  do { code = String(crypto.randomInt(0, 10000)).padStart(4, '0'); }
  while (previous != null && code === String(previous));
  return code;
}

function visitFingerprint(session) {
  return hash(`${session.id}|${session.visitCode}`);
}

function localVisitState(session) {
  if (!storeInstance) return null;
  const current = storeInstance.getMeta(`offline_qr_visit:${session.id}`);
  if (!current || current.fingerprint !== visitFingerprint(session)) return null;
  return current;
}

function localDeviceCount(session) {
  return (localVisitState(session)?.devices || []).length;
}

function ensureVisit(tableId, rotate = false) {
  const { state, table, session } = tableContext(tableId);
  if (!session.billingMode) session.billingMode = 'CONJUNTA';
  session.guestCount = Math.max(1, Number(session.guestCount || 1));
  if (!session.visitCode || rotate) {
    session.visitCode = newVisitCode(rotate ? session.visitCode : null);
    session.visitCodeSource = 'EDGE_LOCAL';
    session.acceptsQrOrders = true;
    saveRestaurantState(state);
    if (storeInstance) {
      storeInstance.setMeta(`offline_qr_visit:${session.id}`, {
        fingerprint: visitFingerprint(session),
        failedAttempts: 0,
        lockedUntil: null,
        devices: [],
        updatedAt: new Date().toISOString()
      });
    }
  }
  return visitPayload(table, session);
}

function visitPayload(table, session) {
  const materials = storeInstance?.getSnapshot('restaurant-local-qr')?.payload || null;
  const material = (materials?.tables || []).find((row) => row.id === table.id || row.qrToken === table.qrToken) || null;
  return {
    open: true,
    table: { id: table.id, code: table.code, name: table.name },
    sessionId: session.id,
    visitCode: session.visitCode || null,
    visitCodeSource: session.visitCodeSource || 'CORE',
    guestCount: Math.max(1, Number(session.guestCount || 1)),
    activeDevices: session.visitCode ? localDeviceCount(session) : 0,
    localQrReady: Boolean(material?.svg && material?.localUrl),
    localQrSvg: material?.svg || null,
    localUrl: material?.localUrl || null,
    materialsVersion: materials?.version || null,
    materialsGeneratedAt: materials?.generatedAt || null
  };
}

function currentVisit(tableId) {
  const { table, session } = tableContext(tableId);
  return visitPayload(table, session);
}

async function refreshLocalQrMaterials(store) {
  if (!CORE_BASE_URL || !EDGE_AGENT_ID || !EDGE_AGENT_KEY || materialFetchInFlight) return;
  if (Date.now() - lastMaterialFetchAt < MATERIAL_REFRESH_MS) return;
  lastMaterialFetchAt = Date.now();
  materialFetchInFlight = true;
  try {
    const cached = store.getSnapshot('restaurant-local-qr')?.payload || null;
    const query = cached?.version ? `?version=${encodeURIComponent(cached.version)}` : '';
    const response = await fetch(`${CORE_BASE_URL}/edge/api/v1/restaurant/local-qr-materials${query}`, {
      signal: AbortSignal.timeout(Number(process.env.EDGE_HTTP_TIMEOUT_MS || 7000)),
      headers: {
        'x-vantix-edge-id': EDGE_AGENT_ID,
        'x-vantix-edge-key': EDGE_AGENT_KEY
      }
    });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({}));
    const data = body?.data;
    if (!data?.available || data.notModified) return;
    if (!data.version || !Array.isArray(data.tables)) return;
    store.putSnapshot('restaurant-local-qr', data.version, data);
  } catch {
    // Keep the last verified QR material snapshot during WAN loss.
  } finally {
    materialFetchInFlight = false;
  }
}

storeModule.EdgeStore = class WanZeroEdgeStore extends OriginalEdgeStore {
  constructor(...args) {
    super(...args);
    storeInstance = this;
  }

  putSnapshot(kind, version, payload) {
    const result = super.putSnapshot(kind, version, payload);
    if (kind === 'restaurant') void refreshLocalQrMaterials(this);
    return result;
  }

  enqueueOperation(operation) {
    if (
      operation?.type === 'RESTAURANT_ORDER_CREATE'
      && String(operation?.payload?.orderSource || '').toUpperCase() === 'QR'
      && String(operation?.payload?.sessionId || '').startsWith('local:')
    ) {
      const localSessionId = String(operation.payload.sessionId);
      operation = {
        ...operation,
        payload: {
          ...operation.payload,
          sessionId: null,
          localSessionOperationId: operation.payload.localSessionOperationId || localSessionId.slice('local:'.length)
        }
      };
    }
    return super.enqueueOperation(operation);
  }
};

async function handle(req, res, url) {
  let match;
  if (req.method === 'GET' && (match = url.pathname.match(/^\/workspace\/api\/offline-waiter\/tables\/([^/]+)\/visit$/))) {
    requireWaiter(req);
    json(res, 200, { ok: true, data: currentVisit(decodeURIComponent(match[1])) });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/offline-waiter\/tables\/([^/]+)\/visit\/ensure$/))) {
    requireWaiter(req);
    json(res, 200, { ok: true, data: ensureVisit(decodeURIComponent(match[1]), false) });
    return true;
  }
  if (req.method === 'POST' && (match = url.pathname.match(/^\/workspace\/api\/offline-waiter\/tables\/([^/]+)\/visit\/rotate$/))) {
    requireWaiter(req);
    json(res, 200, { ok: true, data: ensureVisit(decodeURIComponent(match[1]), true) });
    return true;
  }
  return false;
}

const originalCreateServer = http.createServer;
http.createServer = function wanZeroQrCreateServer(listener) {
  return originalCreateServer.call(http, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (await handle(req, res, url)) return;
      return listener(req, res);
    } catch (error) {
      json(res, Number(error.status || 500), {
        ok: false,
        code: error.code || 'EDGE_WAN_ZERO_QR_ERROR',
        message: error.message || String(error),
        details: error.details || null
      });
    }
  });
};

module.exports = {
  marker: 'EDGE_RESTAURANT_WAN_ZERO_QR_V19',
  newVisitCode,
  visitFingerprint
};
