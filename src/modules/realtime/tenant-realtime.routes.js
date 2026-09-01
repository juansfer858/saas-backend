'use strict';

const express = require('express');
const realtime = require('./tenant-realtime.service');

const router = express.Router();
const MUTATION_METHODS = new Set(['POST','PUT','PATCH','DELETE']);

function cleanPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

function topicsForPath(path) {
  const value = String(path || '').toLowerCase();
  const topics = new Set();
  if (value.includes('/restaurante/')) {
    topics.add('restaurant');
    if (value.includes('/comandas')) topics.add('restaurant.command');
    if (value.includes('/pedidos') || value.includes('/borrador')) topics.add('restaurant.order');
    if (value.includes('/mesas') || value.includes('/sesiones') || value.includes('/zonas')) topics.add('restaurant.table');
    if (value.includes('cuenta') || value.includes('/caja') || value.includes('pago')) topics.add('restaurant.account');
    if (value.includes('/caja') || value.includes('pago') || value.includes('cerrar')) topics.add('treasury');
  }
  if (value.includes('/tesoreria/') || value.includes('/pagos/')) topics.add('treasury');
  if (value.includes('/comercial/')) topics.add('commercial');
  if (value.includes('/contabilidad/')) topics.add('accounting');
  if (value.includes('/inventario/')) topics.add('inventory');
  if (value.includes('/cartera/')) topics.add('portfolio');
  return [...topics];
}

function responseRefs(data, path) {
  const refs = realtime.compactRefs(data || {});
  const parts = String(path || '').split('/').filter(Boolean);
  const after = (label) => {
    const index = parts.indexOf(label);
    return index >= 0 ? parts[index + 1] : null;
  };
  const sessionId = after('sesiones');
  const tableId = after('mesas');
  const commandId = after('comandas');
  if (sessionId && /^[0-9a-f-]{20,}$/i.test(sessionId)) refs.sessionId ||= sessionId;
  if (tableId && /^[0-9a-f-]{20,}$/i.test(tableId)) refs.tableId ||= tableId;
  if (commandId && /^[0-9a-f-]{20,}$/i.test(commandId)) refs.commandId ||= commandId;
  return refs;
}

function tenantRealtimeMutationMiddleware(req, res, next) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return next();
  const path = cleanPath(req);
  const topics = topicsForPath(path);
  if (!topics.length) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals.tenantRealtimeResponse = body?.data ?? body ?? null;
    return originalJson(body);
  };
  res.once('finish', () => {
    if (!req.tenantId || res.statusCode < 200 || res.statusCode >= 400) return;
    realtime.publishTenantChange(
      req.tenantId,
      topics,
      responseRefs(res.locals.tenantRealtimeResponse, path),
      { source:'core-http', method:req.method, path }
    ).catch(() => {});
  });
  next();
}

function writeSse(res, eventName, payload) {
  if (res.writableEnded || res.destroyed) return false;
  if (eventName) res.write(`event: ${eventName}\n`);
  if (payload !== undefined) res.write(`data: ${JSON.stringify(payload)}\n`);
  res.write('\n');
  return true;
}

router.get('/stream', async (req, res) => {
  res.status(200);
  res.set({
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Connection':'keep-alive',
    'X-Accel-Buffering':'no',
    'X-VantixGC-Realtime':'tenant-v1'
  });
  res.flushHeaders?.();
  res.write('retry: 2500\n\n');
  writeSse(res, 'ready', { ...realtime.realtimeStatus(), tenantId:req.tenantId, at:new Date().toISOString() });

  const unsubscribe = realtime.subscribeTenant(req.tenantId, (event) => writeSse(res, 'change', event));
  let keepalive = null;
  let stopped = false;
  const pulse = () => {
    if (stopped || res.writableEnded || res.destroyed) return;
    res.write(': keepalive\n\n');
    keepalive = setTimeout(pulse, 22000);
    keepalive.unref?.();
  };
  keepalive = setTimeout(pulse, 22000);
  keepalive.unref?.();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    if (keepalive) clearTimeout(keepalive);
  };
  req.on('close', stop);
  req.on('aborted', stop);
});

router.get('/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok:true, data:realtime.realtimeStatus() });
});

module.exports = {
  tenantRealtimeRouter: router,
  tenantRealtimeMutationMiddleware,
  topicsForPath,
  responseRefs
};
