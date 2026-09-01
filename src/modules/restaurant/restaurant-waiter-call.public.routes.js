'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { verifyAccessToken } = require('../../utils/jwt');
const visitPayments = require('./restaurant-visit-payments.service');
const calls = require('./restaurant-waiter-call.service');
const waiterDevices = require('./restaurant-waiter-device.service');
const { waiterRuntimeV14 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WATCH_INTERVAL_MS = 1200;
const KEEPALIVE_EVERY_TICKS = 20;
const clientWatchers = new Map();

function visitToken(req) {
  return String(req.get('x-vantix-restaurant-visit') || '').trim();
}

function bearerToken(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function verifyWaiterDeviceRequest(req) {
  const raw = bearerToken(req);
  if (!raw) throw new AppError(401, 'Autenticación de dispositivo requerida', 'RESTAURANT_WAITER_CALL_AUTH_REQUIRED');

  let payload;
  try { payload = verifyAccessToken(raw); }
  catch { throw new AppError(401, 'Sesión de dispositivo no válida', 'RESTAURANT_WAITER_CALL_AUTH_INVALID'); }

  if (!payload?.userId || !payload?.tenantId || payload.authType !== 'WAITER_DEVICE' || !payload.deviceId) {
    throw new AppError(401, 'La sesión no corresponde a un dispositivo Mesero', 'RESTAURANT_WAITER_CALL_DEVICE_REQUIRED');
  }

  const subdomain = String(req.get('x-tenant-subdomain') || '').trim().toLowerCase();
  if (!subdomain) throw new AppError(400, 'Falta el restaurante del dispositivo', 'TENANT_SUBDOMAIN_REQUIRED');

  const [tenant, user] = await Promise.all([
    prisma.tenant.findFirst({ where: { id:payload.tenantId, subdomain, activo:true }, select: { id:true, subdomain:true } }),
    prisma.user.findFirst({ where: { id:payload.userId, tenantId:payload.tenantId, activo:true, rol:'MESERO' }, select: { id:true, nombre:true, rol:true } })
  ]);
  if (!tenant) throw new AppError(403, 'La sesión no pertenece a este restaurante', 'AUTH_TENANT_MISMATCH');
  if (!user) throw new AppError(401, 'El mesero ya no está activo', 'RESTAURANT_WAITER_CALL_WAITER_INVALID');

  await waiterDevices.assertActiveDevice(payload.deviceId, payload.tenantId, payload.userId);
  return { tenantId:payload.tenantId, userId:payload.userId, deviceId:payload.deviceId, user };
}

function sseWrite(res, eventName, payload) {
  if (res.writableEnded || res.destroyed) return false;
  if (eventName) res.write(`event: ${eventName}\n`);
  if (payload !== undefined) res.write(`data: ${JSON.stringify(payload)}\n`);
  res.write('\n');
  return true;
}

function removeClientSubscriber(watcher, res) {
  watcher.subscribers.delete(res);
  if (watcher.subscribers.size) return;
  if (watcher.timer) clearTimeout(watcher.timer);
  clientWatchers.delete(watcher.sessionId);
}

async function pollClientWatcher(watcher) {
  watcher.timer = null;
  if (!watcher.subscribers.size) {
    clientWatchers.delete(watcher.sessionId);
    return;
  }

  try {
    const session = await prisma.restaurantTableSession.findFirst({
      where: { id: watcher.sessionId, tenantId: watcher.tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { qrVisitDevices: { where: { revokedAt: null }, select: { id: true } } }
    });
    watcher.tick += 1;
    if (!session) {
      for (const [res] of watcher.subscribers) {
        sseWrite(res, 'visit-ended', { reason:'TABLE_CLOSED' });
        res.end();
      }
      watcher.subscribers.clear();
      clientWatchers.delete(watcher.sessionId);
      return;
    }

    const activeDevices = new Set(session.qrVisitDevices.map((row) => row.id));
    const snapshot = await calls.sessionCallSnapshot(watcher.tenantId, watcher.sessionId);
    const encoded = JSON.stringify(snapshot);
    for (const [res, subscriber] of [...watcher.subscribers.entries()]) {
      if (res.writableEnded || res.destroyed) {
        watcher.subscribers.delete(res);
        continue;
      }
      if (!activeDevices.has(subscriber.deviceId)) {
        sseWrite(res, 'visit-ended', { reason:'DEVICE_REVOKED' });
        res.end();
        watcher.subscribers.delete(res);
        continue;
      }
      if (subscriber.lastPayload !== encoded) {
        subscriber.lastPayload = encoded;
        sseWrite(res, 'snapshot', snapshot);
      } else if (watcher.tick % KEEPALIVE_EVERY_TICKS === 0) {
        res.write(': keepalive\n\n');
      }
    }
  } catch {
    for (const [res] of watcher.subscribers) sseWrite(res, 'call-error', { message:'Llamado temporalmente no disponible' });
  }

  if (!watcher.subscribers.size) {
    clientWatchers.delete(watcher.sessionId);
    return;
  }
  watcher.timer = setTimeout(() => pollClientWatcher(watcher), WATCH_INTERVAL_MS);
  watcher.timer.unref?.();
}

function subscribeClient(verified, res) {
  let watcher = clientWatchers.get(verified.session.id);
  if (!watcher) {
    watcher = {
      tenantId: verified.table.tenantId,
      sessionId: verified.session.id,
      subscribers: new Map(),
      timer: null,
      tick: 0
    };
    clientWatchers.set(verified.session.id, watcher);
  }
  watcher.subscribers.set(res, { deviceId:verified.device.id, lastPayload:null });
  if (!watcher.timer) {
    watcher.timer = setTimeout(() => pollClientWatcher(watcher), 0);
    watcher.timer.unref?.();
  }
  return () => removeClientSubscriber(watcher, res);
}

router.post('/api/public/restaurante/qr/:token/llamar-mesero', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const data = await calls.createCall(req.params.token, visitToken(req));
    res.status(201).json({ ok:true, data });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/llamar-mesero', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await calls.clientCallSnapshot(req.params.token, visitToken(req)) });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/llamar-mesero/stream', async (req, res, next) => {
  try {
    const verified = await visitPayments.verifyVisit(req.params.token, visitToken(req));
    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const unsubscribe = subscribeClient(verified, res);
    req.on('close', unsubscribe);
    req.on('aborted', unsubscribe);
  } catch (error) { next(error); }
});

// Direct linked-device fallback. This intentionally lives on the public router so it does
// not depend on the generic Core middleware chain. It still performs the complete security
// proof itself: signed JWT, tenant match, MESERO role and active linked device.
router.get('/api/public/restaurante/mesero-dispositivo/llamadas', async (req, res, next) => {
  try {
    const actor = await verifyWaiterDeviceRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await calls.waiterCallsSnapshot(actor.tenantId, actor.userId) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/llamadas/:id/atender', async (req, res, next) => {
  try {
    const actor = await verifyWaiterDeviceRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await calls.attendCall(actor.tenantId, actor.userId, req.params.id) });
  } catch (error) { next(error); }
});

router.get('/app/restaurant-qr-ui.js', async (_req, res, next) => {
  try {
    const [mobileFit, edgeFallback, visitUi, trackingUi, baseUi, callUi] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-mobile-fit.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-edge-fallback-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-visit-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-tracking-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-waiter-call-ui.js'), 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-QR-Assist', 'waiter-call-v1');
    res.type('application/javascript').send(`${mobileFit}\n;${edgeFallback}\n;${visitUi}\n;${trackingUi}\n;${baseUi}\n;${callUi}`);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-call-ui.js', async (_req, res, next) => {
  try {
    const callUi = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-call-ui.js'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Call', 'v20-direct-script');
    res.type('application/javascript').send(callUi);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, runtime] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-session-v8.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-runtime-v7.js'), 'utf8')
    ]);
    const patchedRuntime = waiterRuntimeV14(runtime);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Runtime', 'v14-review-hard-gate');
    res.set('X-VantixGC-Waiter-Call', 'v20-direct-script');
    res.type('application/javascript').send(`${sessionBridge}\n;${patchedRuntime}`);
  } catch (error) { next(error); }
});

module.exports = { restaurantWaiterCallPublicRouter:router };
