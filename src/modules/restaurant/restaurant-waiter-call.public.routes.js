'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { prisma } = require('../../config/prisma');
const visitPayments = require('./restaurant-visit-payments.service');
const calls = require('./restaurant-waiter-call.service');
const { waiterRuntimeV14 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WATCH_INTERVAL_MS = 1200;
const KEEPALIVE_EVERY_TICKS = 20;
const clientWatchers = new Map();

function visitToken(req) {
  return String(req.get('x-vantix-restaurant-visit') || '').trim();
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

// This router is intentionally mounted before the existing visit compositor. It reproduces
// the current approved QR bundle and appends only the two-button waiter-call enhancement.
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

// Same technique for the linked waiter PWA: preserve the V14 hard-gated runtime exactly,
// then append the ringing SSE call surface. No existing waiter engine is forked.
router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, runtime, callUi] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-session-v8.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-runtime-v7.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-call-ui.js'), 'utf8')
    ]);
    const patchedRuntime = waiterRuntimeV14(runtime);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Runtime', 'v14-review-hard-gate-v17-waiter-call');
    res.type('application/javascript').send(`${sessionBridge}\n;${patchedRuntime}\n;${callUi}`);
  } catch (error) { next(error); }
});

module.exports = { restaurantWaiterCallPublicRouter:router };
