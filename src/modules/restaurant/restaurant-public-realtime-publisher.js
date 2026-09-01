'use strict';

const express = require('express');
const { prisma } = require('../../config/prisma');
const { verifyAccessToken } = require('../../utils/jwt');
const realtime = require('../realtime/tenant-realtime.service');

const router = express.Router();
const MUTATIONS = new Set(['POST','PUT','PATCH','DELETE']);

function cleanPath(req) { return String(req.originalUrl || req.url || '').split('?')[0]; }

function publicTopics(path) {
  const value = String(path || '').toLowerCase();
  const topics = new Set(['restaurant']);
  if (value.includes('/pedidos')) topics.add('restaurant.order');
  if (value.includes('/pedir-cuenta') || value.includes('solicitudes-cuenta')) topics.add('restaurant.account');
  if (value.includes('/llamar-mesero') || value.includes('/llamadas')) topics.add('restaurant.call');
  if (value.includes('pago-electronico') || value.includes('pagos-electronicos')) {
    topics.add('restaurant.account');
    topics.add('treasury');
  }
  if (value.includes('/autorizar') || value.includes('/persona')) topics.add('restaurant.visit');
  return [...topics];
}

function captureResponse(res) {
  const original = res.json.bind(res);
  res.json = (body) => {
    res.locals.tenantRealtimePublicResponse = body?.data ?? body ?? null;
    return original(body);
  };
}

function publicResponseRefs(path, response) {
  const refs = realtime.compactRefs(response || {});
  const value = String(path || '').toLowerCase();
  if (value.includes('/pedidos') && response && typeof response === 'object' && typeof response.id === 'string') refs.orderId ||= response.id;
  return refs;
}

router.use('/api/public/restaurante/qr/:token', (req, res, next) => {
  if (!MUTATIONS.has(String(req.method || '').toUpperCase())) return next();
  captureResponse(res);
  const path = cleanPath(req);
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    setTimeout(async () => {
      try {
        const table = await prisma.restaurantTable.findUnique({
          where:{ qrToken:req.params.token },
          select:{ id:true, tenantId:true }
        });
        if (!table) return;
        const active = await prisma.restaurantTableSession.findFirst({
          where:{ tenantId:table.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
          orderBy:{ openedAt:'desc' },
          select:{ id:true }
        });
        const refs = publicResponseRefs(path, res.locals.tenantRealtimePublicResponse || {});
        refs.tableId ||= table.id;
        if (active?.id) refs.sessionId ||= active.id;
        await realtime.publishTenantChange(table.tenantId, publicTopics(path), refs, { source:'restaurant-public-qr', method:req.method, path });
      } catch {}
    }, 0);
  });
  next();
});

router.use('/api/public/restaurante/mesero-dispositivo', (req, res, next) => {
  if (!MUTATIONS.has(String(req.method || '').toUpperCase())) return next();
  const header = String(req.get('authorization') || '');
  let payload = null;
  if (header.startsWith('Bearer ')) {
    try { payload = verifyAccessToken(header.slice(7).trim()); } catch {}
  }
  captureResponse(res);
  const path = cleanPath(req);
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400 || !payload?.tenantId || payload.authType !== 'WAITER_DEVICE') return;
    const refs = publicResponseRefs(path, res.locals.tenantRealtimePublicResponse || {});
    realtime.publishTenantChange(payload.tenantId, publicTopics(path), refs, { source:'restaurant-waiter-device', method:req.method, path }).catch(() => {});
  });
  next();
});

module.exports = { restaurantPublicRealtimePublisher:router, publicTopics, publicResponseRefs };
