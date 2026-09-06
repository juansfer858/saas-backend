'use strict';

const express = require('express');
const { AppError } = require('../../utils/app-error');
const broadcastCalls = require('./restaurant-waiter-call-broadcast.service');
const accountRequests = require('./restaurant-account-request.service');
const waiterDevices = require('./restaurant-waiter-device.service');

const router = express.Router();
const WATCH_INTERVAL_MS = 1200;
const KEEPALIVE_EVERY_TICKS = 20;
const tenantWatchers = new Map();

async function assertAlertActor(req) {
  const role = String(req.userRole || '').toUpperCase();
  if (!broadcastCalls.STAFF_ROLES.has(role)) {
    throw new AppError(403, 'Esta pantalla no puede recibir llamados de mesa', 'RESTAURANT_WAITER_CALL_STAFF_FORBIDDEN');
  }
  if (req.authType === 'WAITER_DEVICE') {
    if (role !== 'MESERO' || !req.deviceId) {
      throw new AppError(403, 'El dispositivo Mesero ya no es válido', 'RESTAURANT_WAITER_CALL_DEVICE_REQUIRED');
    }
    await waiterDevices.assertActiveDevice(req.deviceId, req.tenantId, req.userId);
  }
  return { tenantId:req.tenantId, userId:req.userId, role, deviceId:req.deviceId || null, authType:req.authType || 'USER' };
}

async function waiterAlertSnapshot(tenantId, userId, role = 'MESERO') {
  const calls = await broadcastCalls.waiterCallsSnapshot(tenantId, userId);
  let accountSnapshot = [];
  if (String(role).toUpperCase() === 'MESERO') {
    accountSnapshot = await accountRequests.waiterRequestsSnapshot(tenantId, userId);
  }
  return { ...calls, accountRequests:accountSnapshot };
}

function sseWrite(res, eventName, payload) {
  if (res.writableEnded || res.destroyed) return false;
  if (eventName) res.write(`event: ${eventName}\n`);
  if (payload !== undefined) res.write(`data: ${JSON.stringify(payload)}\n`);
  res.write('\n');
  return true;
}

function subscriberKey(row) { return `${row.userId}:${row.role}`; }
function removeSubscriber(watcher, res) {
  watcher.subscribers.delete(res);
  if (watcher.subscribers.size) return;
  if (watcher.timer) clearTimeout(watcher.timer);
  tenantWatchers.delete(watcher.tenantId);
}

async function pollWatcher(watcher) {
  watcher.timer = null;
  if (!watcher.subscribers.size) return tenantWatchers.delete(watcher.tenantId);
  watcher.tick += 1;
  const snapshots = new Map();
  try {
    for (const subscriber of watcher.subscribers.values()) {
      const key = subscriberKey(subscriber);
      if (!snapshots.has(key)) snapshots.set(key, await waiterAlertSnapshot(watcher.tenantId, subscriber.userId, subscriber.role));
    }
    for (const [res, subscriber] of [...watcher.subscribers.entries()]) {
      if (res.writableEnded || res.destroyed) { watcher.subscribers.delete(res); continue; }
      const snapshot = snapshots.get(subscriberKey(subscriber)) || { calls:[], accountRequests:[] };
      const encoded = JSON.stringify(snapshot);
      if (encoded !== subscriber.lastPayload) {
        subscriber.lastPayload = encoded;
        sseWrite(res, 'snapshot', snapshot);
      } else if (watcher.tick % KEEPALIVE_EVERY_TICKS === 0) res.write(': keepalive\n\n');
    }
  } catch {
    for (const [res] of watcher.subscribers) sseWrite(res, 'call-error', { message:'Alertas de mesa temporalmente no disponibles' });
  }
  if (!watcher.subscribers.size) return tenantWatchers.delete(watcher.tenantId);
  watcher.timer = setTimeout(() => pollWatcher(watcher), WATCH_INTERVAL_MS);
  watcher.timer.unref?.();
}

function subscribe(actor, res) {
  let watcher = tenantWatchers.get(actor.tenantId);
  if (!watcher) {
    watcher = { tenantId:actor.tenantId, subscribers:new Map(), timer:null, tick:0 };
    tenantWatchers.set(actor.tenantId, watcher);
  }
  watcher.subscribers.set(res, { userId:actor.userId, role:actor.role, lastPayload:null });
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

router.get('/llamadas-mesero', async (req, res, next) => {
  try {
    const actor = await assertAlertActor(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await waiterAlertSnapshot(actor.tenantId, actor.userId, actor.role) });
  } catch (error) { next(error); }
});

router.get('/llamadas-mesero/stream', async (req, res, next) => {
  try {
    const actor = await assertAlertActor(req);
    res.status(200);
    res.set({ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate', Connection:'keep-alive', 'X-Accel-Buffering':'no' });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const unsubscribe = subscribe(actor, res);
    req.on('close', unsubscribe);
    req.on('aborted', unsubscribe);
  } catch (error) { next(error); }
});

router.post('/llamadas-mesero/:id/atender', async (req, res, next) => {
  try {
    const actor = await assertAlertActor(req);
    const data = await broadcastCalls.attendCall(actor.tenantId, actor.userId, req.params.id);
    kick(actor.tenantId);
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

router.post('/solicitudes-cuenta/:id/atender', async (req, res, next) => {
  try {
    const actor = await assertAlertActor(req);
    if (actor.role !== 'MESERO') throw new AppError(403, 'La preparación de cuenta corresponde a un mesero', 'RESTAURANT_ACCOUNT_REQUEST_WAITER_REQUIRED');
    const data = await accountRequests.attendRequest(actor.tenantId, actor.userId, req.params.id);
    kick(actor.tenantId);
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantWaiterCallUnifiedRouter:router, assertAlertActor, waiterAlertSnapshot, kick };
