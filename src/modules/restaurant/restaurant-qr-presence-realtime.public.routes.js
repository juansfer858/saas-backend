'use strict';

const express = require('express');
const { prisma } = require('../../config/prisma');
const realtime = require('../realtime/tenant-realtime.service');
const { AppError } = require('../../utils/app-error');

const router = express.Router();

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

router.get('/api/public/restaurante/qr/:token/visita/realtime', async (req, res, next) => {
  try {
    const table = await tableByQr(req.params.token);
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
      'X-VantixGC-Realtime':'restaurant-table-presence-v24'
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
        // The stream stays connected. A later tenant event or reconnect will read canonical state.
      } finally {
        refreshing = false;
      }
    };

    const unsubscribe = realtime.subscribeTenant(table.tenantId, (event) => {
      if (matchesTablePresence(event, table, snapshot.currentSessionId)) refresh().catch(() => {});
    });

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
      unsubscribe();
      if (keepalive) clearTimeout(keepalive);
    };
    req.on('close', stop);
    req.on('aborted', stop);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantQrPresenceRealtimePublicRouter:router,
  presenceSnapshot,
  matchesTablePresence
};
