'use strict';

const express = require('express');
const { prisma } = require('../../config/prisma');
const visitPayments = require('./restaurant-visit-payments.service');

const router = express.Router();
const WATCH_INTERVAL_MS = 1800;
const KEEPALIVE_EVERY_TICKS = 18;
const watchers = new Map();

function visitToken(req) {
  return String(req.get('x-vantix-restaurant-visit') || '').trim();
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicOrder(order) {
  return {
    id: order.id,
    state: order.state,
    total: number(order.total),
    createdAt: order.creadoEn,
    updatedAt: order.actualizadoEn,
    items: (order.items || []).map((item) => ({
      id: item.id,
      description: item.description,
      quantity: number(item.quantity),
      station: item.station,
      seatNumber: item.seatNumber
    })),
    stations: (order.commands || []).map((command) => ({
      id: command.id,
      station: command.station,
      state: command.state,
      startedAt: command.startedAt,
      readyAt: command.readyAt,
      deliveredAt: command.deliveredAt,
      updatedAt: command.actualizadoEn
    }))
  };
}

async function loadSessionState(tenantId, sessionId) {
  return prisma.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: {
      qrVisitDevices: {
        where: { revokedAt: null },
        select: { id: true, seatNumber: true }
      },
      orders: {
        where: { source: 'QR' },
        include: { items: true, commands: true },
        orderBy: { creadoEn: 'asc' }
      }
    }
  });
}

function snapshotFromSession(session, deviceId) {
  const device = (session?.qrVisitDevices || []).find((row) => row.id === deviceId);
  if (!session || !device) return null;
  const orders = (session.orders || []).filter((order) => order.qrVisitDeviceId === deviceId).map(publicOrder);
  return {
    sessionId: session.id,
    seatNumber: device.seatNumber,
    guestCount: session.guestCount,
    orders
  };
}

async function trackingSnapshot(qrToken, rawToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawToken);
  const session = await loadSessionState(verified.table.tenantId, verified.session.id);
  const snapshot = snapshotFromSession(session, verified.device.id);
  if (!snapshot) return { sessionId: verified.session.id, seatNumber: verified.device.seatNumber, guestCount: verified.session.guestCount, orders: [] };
  return snapshot;
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
  watchers.delete(watcher.sessionId);
}

async function pollWatcher(watcher) {
  watcher.timer = null;
  if (!watcher.subscribers.size) {
    watchers.delete(watcher.sessionId);
    return;
  }

  try {
    const session = await loadSessionState(watcher.tenantId, watcher.sessionId);
    watcher.tick += 1;
    if (!session) {
      for (const [res] of watcher.subscribers) {
        sseWrite(res, 'visit-ended', { reason: 'TABLE_CLOSED' });
        res.end();
      }
      watcher.subscribers.clear();
      watchers.delete(watcher.sessionId);
      return;
    }

    for (const [res, subscriber] of [...watcher.subscribers.entries()]) {
      if (res.writableEnded || res.destroyed) {
        watcher.subscribers.delete(res);
        continue;
      }
      const snapshot = snapshotFromSession(session, subscriber.deviceId);
      if (!snapshot) {
        sseWrite(res, 'visit-ended', { reason: 'DEVICE_REVOKED' });
        res.end();
        watcher.subscribers.delete(res);
        continue;
      }
      const encoded = JSON.stringify(snapshot);
      if (encoded !== subscriber.lastPayload) {
        subscriber.lastPayload = encoded;
        sseWrite(res, 'snapshot', snapshot);
      } else if (watcher.tick % KEEPALIVE_EVERY_TICKS === 0) {
        res.write(': keepalive\n\n');
      }
    }
  } catch (error) {
    for (const [res] of watcher.subscribers) sseWrite(res, 'tracking-error', { message: 'Seguimiento temporalmente no disponible' });
  }

  if (!watcher.subscribers.size) {
    watchers.delete(watcher.sessionId);
    return;
  }
  watcher.timer = setTimeout(() => pollWatcher(watcher), WATCH_INTERVAL_MS);
  watcher.timer.unref?.();
}

function subscribe(verified, res) {
  let watcher = watchers.get(verified.session.id);
  if (!watcher) {
    watcher = {
      tenantId: verified.table.tenantId,
      sessionId: verified.session.id,
      subscribers: new Map(),
      timer: null,
      tick: 0
    };
    watchers.set(verified.session.id, watcher);
  }
  watcher.subscribers.set(res, { deviceId: verified.device.id, lastPayload: null });
  if (!watcher.timer) {
    watcher.timer = setTimeout(() => pollWatcher(watcher), 0);
    watcher.timer.unref?.();
  }
  return () => removeSubscriber(watcher, res);
}

router.get('/api/public/restaurante/qr/:token/mis-pedidos', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await trackingSnapshot(req.params.token, visitToken(req)) });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/mis-pedidos/stream', async (req, res, next) => {
  try {
    const verified = await visitPayments.verifyVisit(req.params.token, visitToken(req));
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const unsubscribe = subscribe(verified, res);
    req.on('close', unsubscribe);
    req.on('aborted', unsubscribe);
  } catch (error) { next(error); }
});

module.exports = { restaurantClientTrackingPublicRouter: router, trackingSnapshot };
