'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Client, Pool } = require('pg');

const CHANNEL = 'vantix_tenant_realtime_v1';
const VERSION = 'TENANT_REALTIME_V1';
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let pool = null;
let listener = null;
let listenerStarting = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
const delivered = new Map();

function databaseUrl() {
  return String(process.env.DATABASE_URL || '').trim();
}

function getPool() {
  if (!databaseUrl()) return null;
  if (!pool) pool = new Pool({ connectionString: databaseUrl(), max: 2, application_name: 'vantix-realtime-publisher' });
  return pool;
}

function rememberDelivered(id) {
  delivered.set(id, Date.now());
  if (delivered.size <= 2048) return;
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, at] of delivered) {
    if (at < cutoff || delivered.size > 1536) delivered.delete(key);
    if (delivered.size <= 1536) break;
  }
}

function deliver(event) {
  if (!event?.id || !event?.tenantId || delivered.has(event.id)) return false;
  rememberDelivered(event.id);
  emitter.emit(`tenant:${event.tenantId}`, event);
  return true;
}

function compactRefs(value, depth = 0, output = {}) {
  if (!value || depth > 4) return output;
  if (Array.isArray(value)) {
    for (const row of value.slice(0, 4)) compactRefs(row, depth + 1, output);
    return output;
  }
  if (typeof value !== 'object') return output;
  const keyMap = {
    tenantId: 'tenantId', sessionId: 'sessionId', tableId: 'tableId', orderId: 'orderId',
    commandId: 'commandId', cashShiftId: 'cashShiftId', saleId: 'saleId', documentoId: 'documentoId',
    paymentId: 'paymentId', pagoId: 'paymentId', cajaBancoId: 'cajaBancoId'
  };
  for (const [key, target] of Object.entries(keyMap)) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.length <= 100 && !output[target]) output[target] = raw;
  }
  for (const key of ['session','table','order','command','sale','payment','pago','documento','cashShift']) {
    const nested = value[key];
    if (!nested || typeof nested !== 'object') continue;
    if (typeof nested.id === 'string' && nested.id.length <= 100) {
      const target = ({ session:'sessionId', table:'tableId', order:'orderId', command:'commandId', sale:'saleId', payment:'paymentId', pago:'paymentId', documento:'documentoId', cashShift:'cashShiftId' })[key];
      if (target && !output[target]) output[target] = nested.id;
    }
    compactRefs(nested, depth + 1, output);
  }
  return output;
}

function sanitizeTopics(topics) {
  return [...new Set((Array.isArray(topics) ? topics : [topics])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[a-z0-9_.-]{2,80}$/.test(value)))]
    .slice(0, 16);
}

function makeEvent(tenantId, topics, refs = {}, meta = {}) {
  return {
    id: crypto.randomUUID(),
    version: VERSION,
    tenantId: String(tenantId || ''),
    type: 'tenant.changed',
    topics: sanitizeTopics(topics),
    refs: compactRefs(refs),
    meta: {
      source: String(meta.source || '').slice(0, 80) || null,
      method: String(meta.method || '').slice(0, 12) || null,
      path: String(meta.path || '').slice(0, 220) || null
    },
    at: new Date().toISOString()
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !databaseUrl()) return;
  const wait = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startListener().catch(() => {});
  }, wait);
  reconnectTimer.unref?.();
}

async function startListener() {
  if (!databaseUrl()) return false;
  if (listener) return true;
  if (listenerStarting) return listenerStarting;
  listenerStarting = (async () => {
    const client = new Client({ connectionString: databaseUrl(), application_name: 'vantix-realtime-listener' });
    const lost = () => {
      if (listener === client) listener = null;
      listenerStarting = null;
      scheduleReconnect();
    };
    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try { deliver(JSON.parse(message.payload)); } catch {}
    });
    client.on('error', lost);
    client.on('end', lost);
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      listener = client;
      reconnectDelayMs = 1000;
      return true;
    } catch (error) {
      try { await client.end(); } catch {}
      scheduleReconnect();
      return false;
    } finally {
      listenerStarting = null;
    }
  })();
  return listenerStarting;
}

async function publishTenantChange(tenantId, topics, refs = {}, meta = {}) {
  if (!tenantId) return null;
  const event = makeEvent(tenantId, topics, refs, meta);
  if (!event.topics.length) return null;

  // Local delivery makes the originating process instantaneous. PostgreSQL NOTIFY
  // distributes the same event to every other Core instance; duplicate IDs are ignored.
  deliver(event);
  startListener().catch(() => {});
  const publisher = getPool();
  if (publisher) {
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload, 'utf8') < 7900) {
      try { await publisher.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]); } catch {}
    }
  }
  return event;
}

function subscribeTenant(tenantId, handler) {
  const key = `tenant:${String(tenantId || '')}`;
  emitter.on(key, handler);
  startListener().catch(() => {});
  return () => emitter.off(key, handler);
}

function realtimeStatus() {
  return {
    version: VERSION,
    channel: CHANNEL,
    databaseBroadcast: Boolean(databaseUrl()),
    listenerConnected: Boolean(listener),
    subscribers: emitter.eventNames().reduce((sum, name) => sum + emitter.listenerCount(name), 0)
  };
}

async function shutdownForTest() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  emitter.removeAllListeners();
  const currentListener = listener;
  listener = null;
  listenerStarting = null;
  if (currentListener) {
    currentListener.removeAllListeners('error');
    currentListener.removeAllListeners('end');
    try { await currentListener.end(); } catch {}
  }
  const currentPool = pool;
  pool = null;
  if (currentPool) {
    try { await currentPool.end(); } catch {}
  }
}

module.exports = {
  CHANNEL,
  VERSION,
  compactRefs,
  publishTenantChange,
  subscribeTenant,
  realtimeStatus,
  _deliverForTest: deliver,
  _makeEventForTest: makeEvent,
  _shutdownForTest: shutdownForTest
};
