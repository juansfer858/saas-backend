'use strict';

const express = require('express');
const { AppError } = require('../../utils/app-error');
const calls = require('./restaurant-waiter-call.service');
const accountRequests = require('./restaurant-account-request.service');
const waiterDevices = require('./restaurant-waiter-device.service');

const router = express.Router();
const WATCH_INTERVAL_MS = 1200;
const KEEPALIVE_EVERY_TICKS = 20;
const tenantWatchers = new Map();

async function assertWaiterDeviceRequest(req) {
  if (req.userRole !== 'MESERO' || req.authType !== 'WAITER_DEVICE' || !req.deviceId) {
    throw new AppError(403, 'Este canal sólo está disponible en un dispositivo Mesero vinculado', 'RESTAURANT_WAITER_CALL_DEVICE_REQUIRED');
  }
  await waiterDevices.assertActiveDevice(req.deviceId, req.tenantId, req.userId);
}

async function waiterAlertSnapshot(tenantId, waiterUserId) {
  const [callSnapshot, accountSnapshot] = await Promise.all([
    calls.waiterCallsSnapshot(tenantId, waiterUserId),
    accountRequests.waiterRequestsSnapshot(tenantId, waiterUserId)
  ]);
  return { ...callSnapshot, accountRequests:accountSnapshot };
}

function sseWrite(res, eventName, payload) {
  if (res.writableEnded || res.destroyed) return false;
  if (eventName) res.write(`event: ${eventName}\n`);
  if (payload !== undefined) res.write(`data: ${JSON.stringify(payload)}\n`);
  res.write('\n');
  return true;
}

function removeSubscriber(watcher, res) {
  watcher.subscribers.delete(res);
  if (watcher.subscribers.size) return;
  if (watcher.timer) clearTimeout(watcher.timer);
  tenantWatchers.delete(watcher.tenantId);
}

async function pollWatcher(watcher) {
  watcher.timer = null;
  if (!watcher.subscribers.size) {
    tenantWatchers.delete(watcher.tenantId);
    return;
  }

  watcher.tick += 1;
  const byWaiter = new Map();
  try {
    const waiterIds = [...new Set([...watcher.subscribers.values()].map((row) => row.waiterUserId))];
    for (const waiterId of waiterIds) {
      byWaiter.set(waiterId, await waiterAlertSnapshot(watcher.tenantId, waiterId));
    }
    for (const [res, subscriber] of [...watcher.subscribers.entries()]) {
      if (res.writableEnded || res.destroyed) {
        watcher.subscribers.delete(res);
        continue;
      }
      const snapshot = byWaiter.get(subscriber.waiterUserId) || { calls:[], accountRequests:[] };
      const encoded = JSON.stringify(snapshot);
      if (encoded !== subscriber.lastPayload) {
        subscriber.lastPayload = encoded;
        sseWrite(res, 'snapshot', snapshot);
      } else if (watcher.tick % KEEPALIVE_EVERY_TICKS === 0) {
        res.write(': keepalive\n\n');
      }
    }
  } catch {
    for (const [res] of watcher.subscribers) sseWrite(res, 'call-error', { message:'Alertas de mesa temporalmente no disponibles' });
  }

  if (!watcher.subscribers.size) {
    tenantWatchers.delete(watcher.tenantId);
    return;
  }
  watcher.timer = setTimeout(() => pollWatcher(watcher), WATCH_INTERVAL_MS);
  watcher.timer.unref?.();
}

function subscribe(tenantId, waiterUserId, res) {
  let watcher = tenantWatchers.get(tenantId);
  if (!watcher) {
    watcher = { tenantId, subscribers:new Map(), timer:null, tick:0 };
    tenantWatchers.set(tenantId, watcher);
  }
  watcher.subscribers.set(res, { waiterUserId, lastPayload:null });
  if (!watcher.timer) {
    watcher.timer = setTimeout(() => pollWatcher(watcher), 0);
    watcher.timer.unref?.();
  }
  return () => removeSubscriber(watcher, res);
}

function kick(tenantId) {
  const watcher = tenantWatchers.get(tenantId);
  if (!watcher?.subscribers.size) return;
  if (watcher.timer) clearTimeout(watcher.timer);
  watcher.timer = setTimeout(() => pollWatcher(watcher), 0);
  watcher.timer.unref?.();
}

// These routes are already behind the Core tenant resolver + auth middleware. The
// device assertion below is the authoritative security boundary: only a live,
// explicitly linked WAITER_DEVICE token belonging to an active MESERO can read or
// attend alerts. Do not add a second tenant-RBAC gate here.
router.get('/llamadas-mesero', async (req, res, next) => {
  try {
    await assertWaiterDeviceRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await waiterAlertSnapshot(req.tenantId, req.userId) });
  } catch (error) { next(error); }
});

router.get('/llamadas-mesero/stream', async (req, res, next) => {
  try {
    await assertWaiterDeviceRequest(req);
    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const unsubscribe = subscribe(req.tenantId, req.userId, res);
    req.on('close', unsubscribe);
    req.on('aborted', unsubscribe);
  } catch (error) { next(error); }
});

router.post('/llamadas-mesero/:id/atender', async (req, res, next) => {
  try {
    await assertWaiterDeviceRequest(req);
    const data = await calls.attendCall(req.tenantId, req.userId, req.params.id);
    kick(req.tenantId);
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantWaiterCallRouter:router, waiterAlertSnapshot };
