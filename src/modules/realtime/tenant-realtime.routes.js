'use strict';

const express = require('express');
const realtime = require('./tenant-realtime.service');
const push = require('../notifications/push-v65.service');

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
    if (value.includes('/comandas') || value.includes('/pedido/enviar')) topics.add('restaurant.command');
    if (value.includes('/pedidos') || value.includes('/pedido/') || value.endsWith('/pedido') || value.includes('/borrador')) topics.add('restaurant.order');
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

function pushForMutation(req, topics, path) {
  const method=String(req.method || '').toUpperCase();
  if (method !== 'POST') return;
  const lower=String(path || '').toLowerCase();
  // A command is the high-value production notification. Draft edits are excluded
  // deliberately so adding quantities does not generate notification noise.
  if (topics.includes('restaurant.command')) {
    push.sendOperationalEvent(req.tenantId, {
      eventCode:'RESTAURANT_COMMAND_NEW',
      title:'Nueva comanda',
      body:'Hay un pedido nuevo para preparar.',
      deepLink:'/app/restaurante-v2/kds',
      roles:['COCINA','BARRA','POSTRES','ADMIN','SUPER_ADMIN','ADMINISTRADOR']
    }).catch(() => {});
    return;
  }
  if (topics.includes('restaurant.account') && lower.includes('cuenta')) {
    push.sendOperationalEvent(req.tenantId, {
      eventCode:'RESTAURANT_ACCOUNT_ACTIVITY',
      title:'Solicitud de cuenta',
      body:'Hay una novedad de cuenta que requiere atención.',
      deepLink:'/app/centro-de-control/mesero-v2',
      roles:['MESERO','ADMIN','SUPER_ADMIN','ADMINISTRADOR']
    }).catch(() => {});
  }
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
    // Push is best-effort and never participates in the business transaction.
    pushForMutation(req, topics, path);
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
  responseRefs,
  pushForMutation
};
