'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { prisma } = require('../../config/prisma');
const realtime = require('../realtime/tenant-realtime.service');
const { patchTrackingRealtime } = require('./restaurant-tenant-realtime.public.routes');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const PRESENCE_RECONCILE_MS = 3000;
// VANTIX_QR_TABLE_PRESENCE_V24 remains the public compatibility contract.
// V25 hardens listener readiness and missed-event reconciliation without breaking V24 consumers.

function writeSse(res, eventName, payload) {
  if (res.writableEnded || res.destroyed) return false;
  if (eventName) res.write(`event: ${eventName}\n`);
  if (payload !== undefined) res.write(`data: ${JSON.stringify(payload)}\n`);
  res.write('\n');
  return true;
}

async function tableByQr(token) {
  const table = await prisma.restaurantTable.findUnique({
    where: { qrToken:String(token || '') },
    select: { id:true, tenantId:true, active:true }
  });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  return table;
}

async function presenceSnapshot(table) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: {
      tenantId:table.tenantId,
      tableId:table.id,
      state:{ in:['ABIERTA','CUENTA_PEDIDA'] }
    },
    orderBy:{ openedAt:'desc' },
    select:{ id:true, guestCount:true, state:true }
  });
  return {
    currentSessionId:session?.id || null,
    publicState:{
      open:Boolean(session),
      guestCount:session ? Math.max(Number(session.guestCount || 1), 1) : 0,
      accountRequested:session?.state === 'CUENTA_PEDIDA',
      at:new Date().toISOString()
    }
  };
}

function matchesTablePresence(event, table, currentSessionId) {
  const topics = Array.isArray(event?.topics) ? event.topics : [];
  if (!topics.includes('restaurant.table')) return false;
  const refs = event?.refs || {};
  if (refs.tableId) return refs.tableId === table.id;
  if (refs.sessionId && currentSessionId) return refs.sessionId === currentSessionId;
  return false;
}

function patchVisitPresenceRealtime(source) {
  if (source.includes('VANTIX_QR_TABLE_PRESENCE_V25')) return source;
  let patched = source.replace(
    'localStorage.setItem(STORAGE_KEY, body.data.visitToken);',
    `localStorage.setItem(STORAGE_KEY, body.data.visitToken);\n        window.dispatchEvent(new CustomEvent('vantix:restaurant-visit-authorized', { detail:{ seatNumber:body.data.seatNumber, guestCount:body.data.guestCount } }));`
  );
  const boot = "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refreshVisit().catch(() => {}), { once:true });";
  if (patched.includes(boot)) {
    patched = patched.replace(boot, `// VANTIX_QR_TABLE_PRESENCE_V25: el QR escucha antes de autorizar y se reconcilia si se pierde un NOTIFY.\n  window.addEventListener('vantix:restaurant-table-availability', () => { refreshVisit().catch(() => {}); });\n  window.VantixGCQrTablePresenceV25 = Object.freeze({ version:'25.0.0', automaticOpenClose:true, manualRefreshRequired:false, listenerReadyBeforeInitialState:true, reconcileFallback:true });\n  window.VantixGCQrTablePresenceV24 = window.VantixGCQrTablePresenceV25;\n\n  ${boot}`);
  }
  return patched;
}

// The V25 hardening keeps the V24 public asset contract. All business logic remains in the
// established V22/V23 source files; the patch exposes visit refresh to the table-presence event.
router.get('/app/restaurant-qr-ui.js', async (_req, res, next) => {
  try {
    const [mobileFit, edgeFallback, visitUi, trackingUi, baseUi, callUi, paymentUi, realtimeUi] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-mobile-fit.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-edge-fallback-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-visit-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-tracking-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-waiter-call-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-electronic-payment-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-realtime-ui.js'), 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-QR-Payment', 'v22-electronic-confirmed-by-waiter');
    res.set('X-VantixGC-QR-Realtime', 'v24-table-presence');
    res.set('X-VantixGC-QR-Presence-Hardening', 'v25-listener-ready-reconcile');
    res.type('application/javascript').send(`${mobileFit}\n;${edgeFallback}\n;${patchVisitPresenceRealtime(visitUi)}\n;${patchTrackingRealtime(trackingUi)}\n;${baseUi}\n;${callUi}\n;${paymentUi}\n;${realtimeUi}`);
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/visita/realtime', async (req, res, next) => {
  let unsubscribe = null;
  try {
    const table = await tableByQr(req.params.token);
    const pendingEvents = [];
    let onRealtimeEvent = (event) => pendingEvents.push(event);

    // Subscribe locally first, then wait until PostgreSQL LISTEN is ready before reading the
    // canonical initial state. This closes the race where the waiter opened the table between
    // the initial snapshot and the cross-instance listener becoming active.
    unsubscribe = realtime.subscribeTenant(table.tenantId, (event) => onRealtimeEvent(event));
    await realtime.ensureListenerReady();

    let snapshot = await presenceSnapshot(table);
    let fingerprint = JSON.stringify([
      snapshot.publicState.open,
      snapshot.publicState.guestCount,
      snapshot.publicState.accountRequested,
      snapshot.currentSessionId
    ]);

    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
      'X-VantixGC-Realtime':'restaurant-table-presence-v24',
      'X-VantixGC-Presence-Hardening':'v25-listener-ready-reconcile'
    });
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');
    writeSse(res, 'ready', snapshot.publicState);

    let stopped = false;
    let refreshing = false;
    let queued = false;
    const refresh = async () => {
      if (stopped) return;
      if (refreshing) { queued = true; return; }
      refreshing = true;
      try {
        do {
          queued = false;
          const nextSnapshot = await presenceSnapshot(table);
          const nextFingerprint = JSON.stringify([
            nextSnapshot.publicState.open,
            nextSnapshot.publicState.guestCount,
            nextSnapshot.publicState.accountRequested,
            nextSnapshot.currentSessionId
          ]);
          snapshot = nextSnapshot;
          if (nextFingerprint !== fingerprint) {
            fingerprint = nextFingerprint;
            writeSse(res, 'availability', nextSnapshot.publicState);
          }
        } while (queued && !stopped);
      } catch {
        // The stream stays connected. A later tenant event or reconciliation reads canonical state.
      } finally {
        refreshing = false;
      }
    };

    onRealtimeEvent = (event) => {
      if (matchesTablePresence(event, table, snapshot.currentSessionId)) refresh().catch(() => {});
    };
    for (const event of pendingEvents.splice(0)) onRealtimeEvent(event);

    // NOTIFY remains the immediate path. This low-frequency canonical guard is only a safety net
    // for listener reconnects, proxy interruptions or an event emitted during a network transition.
    let reconcileTimer = null;
    const scheduleReconcile = () => {
      if (stopped || res.writableEnded || res.destroyed) return;
      reconcileTimer = setTimeout(async () => {
        reconcileTimer = null;
        await refresh();
        scheduleReconcile();
      }, PRESENCE_RECONCILE_MS);
      reconcileTimer.unref?.();
    };
    scheduleReconcile();

    let keepalive = null;
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
      unsubscribe?.();
      unsubscribe = null;
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (keepalive) clearTimeout(keepalive);
    };
    req.on('close', stop);
    req.on('aborted', stop);
  } catch (error) {
    unsubscribe?.();
    next(error);
  }
});

module.exports = {
  restaurantQrPresenceRealtimePublicRouter:router,
  PRESENCE_RECONCILE_MS,
  presenceSnapshot,
  matchesTablePresence,
  patchVisitPresenceRealtime
};
