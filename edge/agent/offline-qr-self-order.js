'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EdgeStore } = require('./store');

const LOCAL_KEY = process.env.EDGE_LOCAL_ENCRYPTION_KEY || '';
const INSTALL_ROOT = process.env.EDGE_INSTALL_ROOT
  || (fs.existsSync(path.join(process.cwd(), 'agent', 'server.js')) ? process.cwd() : path.resolve(__dirname, '..'));
const DATA_DIR = process.env.EDGE_DATA_DIR || path.join(INSTALL_ROOT, 'data');
const DB_PATH = process.env.EDGE_DB_PATH || path.join(DATA_DIR, 'vantixgc-edge.sqlite');
const store = new EdgeStore(DB_PATH, LOCAL_KEY);

const VISIT_MAX_FAILURES = 5;
const VISIT_LOCK_MS = 10 * 60_000;
const VISIT_ORDER_WINDOW_MS = 60_000;
const VISIT_MAX_ORDERS_PER_WINDOW = 6;
const VISIT_MAX_UNITS_PER_ORDER = 40;
const MAX_BODY_BYTES = 1024 * 1024;

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-VantixGC-Edge-QR': 'offline-lan-v1'
  });
  res.end(data);
}

function html(res, body) {
  const data = Buffer.from(body);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-VantixGC-Edge-QR': 'offline-lan-v1'
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw edgeError(413, 'EDGE_QR_PAYLOAD_TOO_LARGE', 'El pedido es demasiado grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw edgeError(400, 'EDGE_QR_JSON_INVALID', 'Datos del pedido inválidos'); }
}

function edgeError(status, code, message, details = null) {
  return Object.assign(new Error(message), { status, code, details });
}

function normalizedRemoteAddress(req) {
  return String(req.socket?.remoteAddress || '').toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

function isPrivateLanAddress(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return false;
  if (value === '::1' || value === '127.0.0.1') return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(value)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(value)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(value)) return true;
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(value)) return true;
  if (/^(?:fc|fd)[0-9a-f:]+$/i.test(value) || /^fe[89ab][0-9a-f:]+$/i.test(value)) return true;
  return false;
}

function requireLanClient(req) {
  if (!isPrivateLanAddress(normalizedRemoteAddress(req))) {
    throw edgeError(403, 'EDGE_QR_LAN_REQUIRED', 'El autopedido local sólo funciona conectado a la red del restaurante');
  }
}

function restaurantState() {
  return store.getSnapshot('restaurant')?.payload || { tables: [], menu: [], commands: [], cashShifts: [] };
}

function saveRestaurantState(state) {
  store.putSnapshot('restaurant-local', String(Date.now()), state);
  store.putSnapshot('restaurant', `offline-qr-${Date.now()}`, state);
}

function tenantName() {
  const bootstrap = store.getSnapshot('bootstrap')?.payload || {};
  return String(bootstrap.tenant?.nombreEmpresa || bootstrap.tenant?.name || 'Restaurante');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function tableContext(qrToken) {
  const state = restaurantState();
  const table = (state.tables || []).find((row) => row.qrToken === qrToken);
  if (!table) throw edgeError(404, 'EDGE_QR_TABLE_NOT_FOUND', 'Este QR no pertenece a una mesa disponible en este punto');
  const session = table.activeSession;
  if (!session?.id) throw edgeError(409, 'EDGE_QR_TABLE_NOT_OPEN', 'La mesa todavía no está abierta');
  if (!session.visitCode) throw edgeError(409, 'EDGE_QR_VISIT_NOT_SYNCED', 'La visita de esta mesa todavía no estaba sincronizada cuando se perdió Internet. Pídele al mesero que registre el pedido desde su tablet.');
  if (session.acceptsQrOrders === false || session.state !== 'ABIERTA') {
    throw edgeError(409, 'EDGE_QR_ACCOUNT_LOCKED', 'La cuenta de esta mesa ya está en proceso de cierre; no se pueden agregar más productos');
  }
  return { state, table, session };
}

function authKey(sessionId) {
  return `offline_qr_visit:${sessionId}`;
}

function visitFingerprint(session) {
  return hash(`${session.id}|${session.visitCode}`);
}

function visitState(session) {
  const key = authKey(session.id);
  const fingerprint = visitFingerprint(session);
  const current = store.getMeta(key);
  if (!current || current.fingerprint !== fingerprint) {
    const fresh = { fingerprint, failedAttempts: 0, lockedUntil: null, devices: [], updatedAt: new Date().toISOString() };
    store.setMeta(key, fresh);
    return fresh;
  }
  const devices = (current.devices || []).slice(-20).map((device) => ({
    ...device,
    orders: (device.orders || []).filter((stamp) => Date.now() - Number(stamp) <= VISIT_ORDER_WINDOW_MS),
    requests: Object.fromEntries(Object.entries(device.requests || {}).filter(([, value]) => Date.now() - Number(value?.createdAt || 0) <= 6 * 60 * 60_000))
  }));
  return { ...current, devices };
}

function saveVisitState(session, value) {
  const next = { ...value, fingerprint: visitFingerprint(session), updatedAt: new Date().toISOString() };
  store.setMeta(authKey(session.id), next);
  return next;
}

function normalizeSeat(session, seatNumber) {
  const count = Math.max(1, Number(session.guestCount || 1));
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > count) {
    throw edgeError(400, 'EDGE_QR_SEAT_INVALID', 'Selecciona una persona válida de esta mesa', { guestCount: count });
  }
  return seat;
}

function visitToken(req) {
  return String(req.headers['x-vantix-restaurant-visit'] || '').trim();
}

function verifyDevice(qrToken, rawToken) {
  const { state, table, session } = tableContext(qrToken);
  if (!rawToken) throw edgeError(401, 'EDGE_QR_VISIT_REQUIRED', 'Ingresa el código de la mesa para autorizar este teléfono');
  const current = visitState(session);
  const tokenHash = hash(rawToken);
  const device = current.devices.find((row) => safeEqual(row.tokenHash, tokenHash));
  if (!device) throw edgeError(401, 'EDGE_QR_VISIT_INVALID', 'La autorización de este teléfono ya no es válida');
  if (Number(device.seatNumber || 0) > Number(session.guestCount || 1)) {
    throw edgeError(409, 'EDGE_QR_VISIT_SEAT_INVALID', 'La persona asociada a este teléfono ya no existe en la mesa');
  }
  device.lastSeenAt = Date.now();
  saveVisitState(session, current);
  return { state, table, session, current, device };
}

function authorize(qrToken, input) {
  const { session } = tableContext(qrToken);
  const code = String(input.code || '').trim();
  if (!/^\d{4}$/.test(code)) throw edgeError(400, 'EDGE_QR_VISIT_CODE_REQUIRED', 'El código debe tener 4 dígitos');
  const current = visitState(session);
  if (current.lockedUntil && Number(current.lockedUntil) > Date.now()) {
    throw edgeError(429, 'EDGE_QR_VISIT_LOCKED', 'Código temporalmente bloqueado por varios intentos incorrectos. Solicita uno nuevo al mesero.', { lockedUntil: new Date(Number(current.lockedUntil)).toISOString() });
  }
  if (!safeEqual(session.visitCode, code)) {
    const attempts = Number(current.failedAttempts || 0) + 1;
    current.failedAttempts = attempts >= VISIT_MAX_FAILURES ? 0 : attempts;
    current.lockedUntil = attempts >= VISIT_MAX_FAILURES ? Date.now() + VISIT_LOCK_MS : null;
    saveVisitState(session, current);
    throw edgeError(
      attempts >= VISIT_MAX_FAILURES ? 429 : 403,
      attempts >= VISIT_MAX_FAILURES ? 'EDGE_QR_VISIT_LOCKED' : 'EDGE_QR_VISIT_CODE_INVALID',
      attempts >= VISIT_MAX_FAILURES ? 'Demasiados intentos. Solicita al mesero cambiar el código.' : 'Código de mesa incorrecto',
      { attemptsRemaining: attempts >= VISIT_MAX_FAILURES ? 0 : VISIT_MAX_FAILURES - attempts }
    );
  }
  const maxDevices = Math.min(Math.max(Number(session.guestCount || 1) * 2 + 2, 4), 20);
  if (current.devices.length >= maxDevices) {
    throw edgeError(429, 'EDGE_QR_VISIT_DEVICE_LIMIT', 'Esta mesa ya tiene demasiados teléfonos autorizados. Solicita al mesero reiniciar el acceso QR.');
  }
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const device = {
    id: crypto.randomUUID(),
    tokenHash: hash(rawToken),
    seatNumber: normalizeSeat(session, input.seatNumber),
    authorizedAt: Date.now(),
    lastSeenAt: Date.now(),
    orders: [],
    requests: {}
  };
  current.failedAttempts = 0;
  current.lockedUntil = null;
  current.devices.push(device);
  saveVisitState(session, current);
  return { visitToken: rawToken, sessionId: session.id, seatNumber: device.seatNumber, guestCount: Number(session.guestCount || 1), local: true, expiresWhenTableCloses: true };
}

function describeVisit(qrToken, rawToken) {
  const { session } = tableContext(qrToken);
  if (!rawToken) return { open: true, authorized: false, guestCount: Number(session.guestCount || 1), seatNumber: null, local: true };
  try {
    const verified = verifyDevice(qrToken, rawToken);
    return { open: true, authorized: true, guestCount: Number(session.guestCount || 1), seatNumber: verified.device.seatNumber, local: true };
  } catch (error) {
    if (['EDGE_QR_VISIT_INVALID', 'EDGE_QR_VISIT_REQUIRED'].includes(error.code)) {
      return { open: true, authorized: false, guestCount: Number(session.guestCount || 1), seatNumber: null, local: true };
    }
    throw error;
  }
}

function changeSeat(qrToken, rawToken, input) {
  const verified = verifyDevice(qrToken, rawToken);
  verified.device.seatNumber = normalizeSeat(verified.session, input.seatNumber);
  verified.device.lastSeenAt = Date.now();
  saveVisitState(verified.session, verified.current);
  return { seatNumber: verified.device.seatNumber, guestCount: Number(verified.session.guestCount || 1), local: true };
}

function lineTotal(menuItem, quantity) {
  const product = menuItem?.product || {};
  const subtotal = Number(product.precio1 || 0) * Number(quantity || 0);
  const iva = subtotal * Number(product.ivaPct || 0) / 100;
  const impoconsumo = subtotal * Number(product.impoconsumoPct || 0) / 100;
  return Number((subtotal + iva + impoconsumo).toFixed(2));
}

function normalizeOrderItems(state, session, device, input) {
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw edgeError(400, 'EDGE_QR_ORDER_ITEMS_INVALID', 'Agrega al menos un producto al pedido');
  }
  const menu = new Map((state.menu || []).map((row) => [row.id, row]));
  let units = 0;
  let total = 0;
  const items = input.items.map((item) => {
    const menuItem = menu.get(String(item.menuItemId || ''));
    const quantity = Number(item.quantity || 0);
    if (!menuItem?.available || !Number.isFinite(quantity) || quantity <= 0 || quantity > 20) {
      throw edgeError(400, 'EDGE_QR_MENU_ITEM_INVALID', 'El pedido contiene un producto no disponible');
    }
    const notes = String(item.notes || '').trim();
    if (notes.length > 300) throw edgeError(400, 'EDGE_QR_ITEM_NOTE_TOO_LONG', 'Una nota del pedido es demasiado larga');
    units += quantity;
    total += lineTotal(menuItem, quantity);
    return {
      menuItemId: menuItem.id,
      quantity,
      notes: notes || null,
      seatNumber: Number(device.seatNumber || 1),
      serviceBillingMode: session.billingMode || 'CONJUNTA',
      serviceGuestCount: Number(session.guestCount || 1)
    };
  });
  if (units > VISIT_MAX_UNITS_PER_ORDER) throw edgeError(400, 'EDGE_QR_ORDER_TOO_LARGE', `Máximo ${VISIT_MAX_UNITS_PER_ORDER} unidades por envío QR`);
  const expected = Number(total.toFixed(2));
  const confirmed = Number(input.confirmedTotal);
  if (!Number.isFinite(confirmed) || Math.abs(expected - confirmed) > 0.01) {
    throw edgeError(409, 'EDGE_QR_TOTAL_CHANGED', 'El valor del pedido cambió. Revisa el total antes de enviarlo.', { expectedTotal: expected });
  }
  return { items, total: expected };
}

function enqueueLocalQrOrder(verified, input) {
  const { state, table, session, current, device } = verified;
  const now = Date.now();
  device.orders = (device.orders || []).filter((stamp) => now - Number(stamp) <= VISIT_ORDER_WINDOW_MS);
  if (device.orders.length >= VISIT_MAX_ORDERS_PER_WINDOW) {
    throw edgeError(429, 'EDGE_QR_ORDER_RATE_LIMIT', 'Demasiados pedidos seguidos desde este teléfono. Espera un momento.');
  }
  const externalRequestId = String(input.externalRequestId || '').trim().slice(0, 120);
  if (externalRequestId && device.requests?.[externalRequestId]) {
    return device.requests[externalRequestId].response;
  }
  const normalized = normalizeOrderItems(state, session, device, input);
  const operation = {
    id: crypto.randomUUID(),
    type: 'RESTAURANT_ORDER_CREATE',
    localTimestamp: new Date().toISOString(),
    payload: {
      sessionId: session.id,
      localSessionOperationId: null,
      orderSource: 'QR',
      qrToken: table.qrToken,
      offlineQrDeviceId: device.id,
      items: normalized.items,
      notes: String(input.notes || '').trim().slice(0, 500) || null,
      customerPhoneE164: null
    }
  };
  store.enqueueOperation(operation);

  const menu = new Map((state.menu || []).map((row) => [row.id, row]));
  const byStation = new Map();
  for (const item of normalized.items) {
    const menuItem = menu.get(item.menuItemId);
    if (!byStation.has(menuItem.station)) byStation.set(menuItem.station, []);
    byStation.get(menuItem.station).push({
      description: menuItem.product?.nombre || 'Producto',
      quantity: Number(item.quantity),
      notes: item.notes || null,
      seatNumber: Number(item.seatNumber || 1)
    });
  }
  if (!Array.isArray(state.commands)) state.commands = [];
  for (const [station, items] of byStation) {
    state.commands.push({
      id: `local:${operation.id}:${station}`,
      localOrderOperationId: operation.id,
      source: 'QR',
      station,
      state: 'PENDIENTE',
      createdAt: operation.localTimestamp,
      table: { id: table.id, code: table.code, name: table.name },
      items
    });
  }
  saveRestaurantState(state);

  const response = {
    id: `local:${operation.id}`,
    operationId: operation.id,
    sessionId: session.id,
    state: 'ENVIADO',
    source: 'QR',
    total: normalized.total,
    seatNumber: Number(device.seatNumber || 1),
    local: true,
    queuedForSync: true
  };
  device.orders.push(now);
  if (!device.requests) device.requests = {};
  if (externalRequestId) device.requests[externalRequestId] = { createdAt: now, response };
  saveVisitState(session, current);
  return response;
}

function publicContext(qrToken, rawToken) {
  const { state, table, session } = tableContext(qrToken);
  const visit = describeVisit(qrToken, rawToken);
  return {
    local: true,
    mode: 'EDGE_LAN_OFFLINE',
    restaurantName: tenantName(),
    table: { id: table.id, code: table.code, name: table.name },
    session: { id: session.id, billingMode: session.billingMode || 'CONJUNTA', guestCount: Number(session.guestCount || 1) },
    visit,
    menu: (state.menu || []).filter((row) => row.available !== false && row.product).map((row) => ({
      id: row.id,
      category: row.category,
      station: row.station,
      available: row.available !== false,
      product: {
        id: row.product.id,
        nombre: row.product.nombre,
        precio1: Number(row.product.precio1 || 0),
        ivaPct: Number(row.product.ivaPct || 0),
        impoconsumoPct: Number(row.product.impoconsumoPct || 0)
      }
    }))
  };
}

function localPage(qrToken) {
  const tokenJson = JSON.stringify(qrToken).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#181614"><title>Autopedido local · VantixGC</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#201c18;background:#f6f1e8}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f6f1e8,#fffaf2);min-height:100vh}.shell{max-width:920px;margin:auto;padding:12px 12px 110px}.hero{padding:18px;border-radius:20px;background:#181614;color:white;box-shadow:0 14px 32px #0002}.hero small{display:block;color:#f28a39;font-weight:900;letter-spacing:.1em}.hero h1{margin:5px 0 0;font-size:30px}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pill{padding:7px 10px;border-radius:999px;background:#ffffff15;border:1px solid #ffffff35;font-size:12px;font-weight:900}.local{background:#f28a39;color:#181614;border-color:#f28a39}.notice{margin:12px 0;padding:12px 14px;border:1px solid #d7b566;border-radius:14px;background:#fff6d9;color:#5f4511;font-size:13px;font-weight:750}.auth,.panel{margin-top:12px;padding:17px;border:1px solid #dfd1bf;border-radius:18px;background:#fffdf8;box-shadow:0 8px 20px #201c180d}.auth h2,.panel h2{margin:0 0 8px}.code{width:100%;height:68px;border:2px solid #d8c9b6;border-radius:14px;text-align:center;font-size:34px;font-weight:900;letter-spacing:.25em;padding-left:.25em}.seats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.seat{min-height:48px;border:1px solid #d8c9b6;border-radius:12px;background:white;font-weight:900}.seat.on{border-color:#ef6f24;background:#fff0e5;color:#b8430b}.primary{width:100%;min-height:58px;margin-top:12px;border:0;border-radius:14px;background:#ef6f24;color:white;font-weight:900;font-size:16px}.error{margin-top:10px;padding:10px;border-radius:10px;background:#fff0ef;color:#991b1b;font-weight:800}.person{display:flex;align-items:center;gap:8px;margin:12px 0;padding:10px 12px;border:1px solid #a8c9b9;border-radius:13px;background:#eef8f2;color:#255a48;font-weight:900}.person button{margin-left:auto;border:1px solid #8db7a6;border-radius:9px;background:#fff;padding:8px;font-weight:900}.cats{display:flex;gap:7px;overflow:auto;padding:2px 0 10px}.cat{white-space:nowrap;min-height:44px;padding:0 12px;border:1px solid #d9cbb8;border-radius:12px;background:white;font-weight:900}.cat.on{background:#181614;color:white}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.product{padding:14px;border:1px solid #dfd1bf;border-radius:16px;background:#fff}.product h3{margin:0;font-size:17px}.product small{display:block;margin-top:4px;color:#766b61}.price{display:block;margin:10px 0;color:#d95b15;font-size:20px;font-weight:900}.step{display:grid;grid-template-columns:46px 1fr 46px;height:48px;border:1px solid #dfd1bf;border-radius:12px;overflow:hidden}.step button{border:0;background:white;font-size:24px;font-weight:900}.step button:last-child{background:#ef6f24;color:white}.step b{display:grid;place-items:center}.cart{position:fixed;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(896px,calc(100% - 16px));display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:11px 12px;border-radius:17px;background:#181614;color:white;box-shadow:0 18px 36px #0004}.cart strong{display:block}.cart span{color:#f28a39;font-size:21px;font-weight:900}.cart button{min-height:52px;border:0;border-radius:12px;background:#ef6f24;color:white;padding:0 16px;font-weight:900}.overlay{position:fixed;inset:0;z-index:50;display:grid;place-items:end center;padding:8px;background:#0009}.sheet{width:min(620px,100%);max-height:85vh;overflow:auto;padding:18px;border-radius:22px 22px 14px 14px;background:#fffdf8}.line{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #eadfce}.sheet .secondary{width:100%;min-height:48px;margin-top:8px;border:1px solid #d8c9b6;border-radius:12px;background:white;font-weight:900}.success{padding:20px;text-align:center}.success b{display:block;font-size:28px;color:#2f6e58}.hidden{display:none!important}@media(max-width:560px){.grid{grid-template-columns:1fr}.seats{grid-template-columns:repeat(2,minmax(0,1fr))}.hero h1{font-size:26px}}
</style></head><body><main class="shell"><header class="hero"><small>VANTIXGC RESTAURANTES</small><h1 id="restaurantName">Restaurante</h1><div class="meta"><span id="tableName" class="pill">Mesa</span><span class="pill local">MODO LOCAL · RED DEL RESTAURANTE</span></div></header><div class="notice">Tu pedido viaja directamente al equipo local del restaurante. No depende de Internet y aparecerá en Cocina/Barra/Postres dentro de la sede.</div><section id="auth" class="auth hidden"><h2>Confirma que estás en esta mesa</h2><p>Escribe los 4 números que te dio el mesero.</p><input id="code" class="code" inputmode="numeric" maxlength="4" placeholder="••••"><div id="seats" class="seats"></div><button id="authorize" class="primary">ENTRAR A ESTA MESA</button><div id="authError" class="error hidden"></div></section><div id="person" class="person hidden"></div><section id="menuPanel" class="panel hidden"><h2>¿Qué quieres pedir?</h2><div id="cats" class="cats"></div><div id="grid" class="grid"></div></section></main><div id="cart" class="cart hidden"><div><strong id="cartCopy">0 productos</strong><span id="cartTotal">$0</span></div><button id="review">REVISAR PEDIDO</button></div><div id="overlay" class="overlay hidden"></div>
<script>
(()=>{'use strict';const QR=${tokenJson};const API='/local-qr/api/'+encodeURIComponent(QR);const KEY='vantixgc_edge_qr_visit_'+QR;let ctx=null,seat=1,cat='TODOS';const basket=new Map();const $=s=>document.querySelector(s);const money=n=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(n||0));const token=()=>localStorage.getItem(KEY)||'';function headers(extra={}){const h={...extra};if(token())h['x-vantix-restaurant-visit']=token();return h}async function api(path,opt={}){const r=await fetch(API+path,{cache:'no-store',...opt,headers:headers(opt.headers||{})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.message||b.error?.message||'No fue posible completar la acción');return b.data}function lineTotal(row,q){const p=row.product||{};const s=Number(p.precio1||0)*q;return Number((s+s*Number(p.ivaPct||0)/100+s*Number(p.impoconsumoPct||0)/100).toFixed(2))}function seats(){const root=$('#seats');root.innerHTML='';const n=Math.max(1,Number(ctx.session.guestCount||1));for(let i=1;i<=n;i++){const b=document.createElement('button');b.className='seat'+(i===seat?' on':'');b.textContent='Persona '+i;b.onclick=()=>{seat=i;seats()};root.appendChild(b)}}function person(){const root=$('#person');root.classList.remove('hidden');root.innerHTML='<span>✓ Teléfono autorizado · Persona '+seat+'</span>'+(Number(ctx.session.guestCount||1)>1?'<button type="button">Cambiar persona</button>':'');root.querySelector('button')?.addEventListener('click',async()=>{const n=Number(prompt('Persona (1 a '+ctx.session.guestCount+')',String(seat)));if(!Number.isInteger(n))return;try{const d=await api('/persona',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({seatNumber:n})});seat=Number(d.seatNumber||1);person()}catch(e){alert(e.message)}})}function categories(){const values=['TODOS',...new Set(ctx.menu.map(x=>x.category||'OTROS'))];const root=$('#cats');root.innerHTML='';values.forEach(v=>{const b=document.createElement('button');b.className='cat'+(v===cat?' on':'');b.textContent=v==='TODOS'?'Todo':v;b.onclick=()=>{cat=v;categories();products()};root.appendChild(b)})}function products(){const root=$('#grid');root.innerHTML='';ctx.menu.filter(x=>cat==='TODOS'||x.category===cat).forEach(row=>{const q=Number(basket.get(row.id)||0);const card=document.createElement('article');card.className='product';card.innerHTML='<h3></h3><small></small><span class="price"></span><div class="step"><button type="button">−</button><b>'+q+'</b><button type="button">+</button></div>';card.querySelector('h3').textContent=row.product.nombre;card.querySelector('small').textContent=row.category+' · '+row.station;card.querySelector('.price').textContent=money(lineTotal(row,1));const buttons=card.querySelectorAll('button');buttons[0].onclick=()=>setQty(row.id,Math.max(0,q-1));buttons[1].onclick=()=>setQty(row.id,Math.min(20,q+1));root.appendChild(card)});cart()}function setQty(id,q){if(q)basket.set(id,q);else basket.delete(id);products()}function summary(){let units=0,total=0;for(const [id,q]of basket){const row=ctx.menu.find(x=>x.id===id);if(!row)continue;units+=q;total+=lineTotal(row,q)}return{units,total:Number(total.toFixed(2))}}function cart(){const s=summary();$('#cart').classList.toggle('hidden',s.units===0);$('#cartCopy').textContent=s.units+' producto'+(s.units===1?'':'s');$('#cartTotal').textContent=money(s.total)}function review(){const s=summary();const lines=[...basket].map(([id,q])=>{const row=ctx.menu.find(x=>x.id===id);return '<div class="line"><span>'+escapeHtml(row.product.nombre)+' × '+q+'</span><b>'+money(lineTotal(row,q))+'</b></div>'}).join('');$('#overlay').classList.remove('hidden');$('#overlay').innerHTML='<section class="sheet"><h2>Revisa tu pedido</h2>'+lines+'<div class="line"><strong>Total</strong><strong>'+money(s.total)+'</strong></div><button id="send" class="primary">CONFIRMAR PEDIDO</button><button id="cancel" class="secondary">VOLVER</button></section>';$('#cancel').onclick=()=>$('#overlay').classList.add('hidden');$('#send').onclick=send}function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}async function send(){const btn=$('#send');btn.disabled=true;btn.textContent='ENVIANDO…';const s=summary();try{const data=await api('/pedidos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[...basket].map(([menuItemId,quantity])=>({menuItemId,quantity})),confirmedTotal:s.total,externalRequestId:(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random())})});basket.clear();products();$('#overlay').innerHTML='<section class="sheet success"><b>✓ Pedido enviado</b><p>Ya apareció en el sistema local del restaurante.</p><button id="done" class="primary">SEGUIR PIDIENDO</button></section>';$('#done').onclick=()=>$('#overlay').classList.add('hidden')}catch(e){btn.disabled=false;btn.textContent='CONFIRMAR PEDIDO';alert(e.message)}}async function init(){try{ctx=await api('/context');$('#restaurantName').textContent=ctx.restaurantName;$('#tableName').textContent=ctx.table.name||ctx.table.code;seat=Number(ctx.visit.seatNumber||1);if(ctx.visit.authorized){person();$('#menuPanel').classList.remove('hidden');categories();products()}else{$('#auth').classList.remove('hidden');seats()}}catch(e){document.querySelector('.shell').insertAdjacentHTML('beforeend','<div class="error">'+escapeHtml(e.message)+'</div>')}}$('#code').addEventListener('input',e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,4));$('#authorize').onclick=async()=>{const btn=$('#authorize'),err=$('#authError');btn.disabled=true;err.classList.add('hidden');try{const d=await api('/autorizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#code').value,seatNumber:seat})});localStorage.setItem(KEY,d.visitToken);ctx=await api('/context');seat=Number(ctx.visit.seatNumber||1);$('#auth').classList.add('hidden');person();$('#menuPanel').classList.remove('hidden');categories();products()}catch(e){err.textContent=e.message;err.classList.remove('hidden');btn.disabled=false}};$('#review').onclick=review;init()})();
</script></body></html>`;
}

async function handle(req, res, url) {
  const pageMatch = url.pathname.match(/^\/r\/([^/]+)$/);
  const apiMatch = url.pathname.match(/^\/local-qr\/api\/([^/]+)(?:\/(context|visita|autorizar|persona|pedidos))?$/);
  if (!pageMatch && !apiMatch) return false;
  requireLanClient(req);

  if (pageMatch) {
    if (req.method !== 'GET') throw edgeError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido');
    const qrToken = decodeURIComponent(pageMatch[1]);
    tableContext(qrToken);
    html(res, localPage(qrToken));
    return true;
  }

  const qrToken = decodeURIComponent(apiMatch[1]);
  const action = apiMatch[2] || 'context';
  if (req.method === 'GET' && action === 'context') {
    json(res, 200, { ok: true, data: publicContext(qrToken, visitToken(req)) });
    return true;
  }
  if (req.method === 'GET' && action === 'visita') {
    json(res, 200, { ok: true, data: describeVisit(qrToken, visitToken(req)) });
    return true;
  }
  if (req.method === 'POST' && action === 'autorizar') {
    json(res, 200, { ok: true, data: authorize(qrToken, await readJson(req)) });
    return true;
  }
  if (req.method === 'PATCH' && action === 'persona') {
    json(res, 200, { ok: true, data: changeSeat(qrToken, visitToken(req), await readJson(req)) });
    return true;
  }
  if (req.method === 'POST' && action === 'pedidos') {
    json(res, 201, { ok: true, data: enqueueLocalQrOrder(verifyDevice(qrToken, visitToken(req)), await readJson(req)) });
    return true;
  }
  throw edgeError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido');
}

const originalCreateServer = http.createServer;
http.createServer = function offlineQrCreateServer(listener) {
  return originalCreateServer.call(http, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (await handle(req, res, url)) return;
      return listener(req, res);
    } catch (error) {
      json(res, Number(error.status || 400), { ok: false, code: error.code || 'EDGE_QR_LOCAL_ERROR', message: error.message || String(error), details: error.details || null });
    }
  });
};

module.exports = {
  marker: 'EDGE_RESTAURANT_QR_OFFLINE_LAN_V1',
  isPrivateLanAddress,
  lineTotal
};
