'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { verifyAccessToken } = require('../../utils/jwt');
const visitPayments = require('./restaurant-visit-payments.service');
const electronic = require('./restaurant-electronic-payment.service');
const waiterDevices = require('./restaurant-waiter-device.service');
const { waiterPwaV11, waiterRuntimeV14 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const CLIENT_WATCH_MS = 900;
const WAITER_WATCH_MS = 1200;
const KEEPALIVE_TICKS = 20;
const waiterWatchers = new Map();

const WAITER_RUNTIME_QUERY_V22 = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v22-electronic-payment';
const WAITER_CALL_QUERY_V21 = 'restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request';
const WAITER_PAYMENT_QUERY_V22 = 'restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22';
const WAITER_CACHE_V22 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v22-electronic-payment';
const LEGACY_RUNTIME_REFERENCE = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14';

function visitToken(req) {
  return String(req.get('x-vantix-restaurant-visit') || '').trim();
}

function bearerToken(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function verifyWaiterDeviceRequest(req) {
  const raw = bearerToken(req);
  if (!raw) throw new AppError(401, 'Autenticación de dispositivo requerida', 'RESTAURANT_ELECTRONIC_WAITER_AUTH_REQUIRED');
  let payload;
  try { payload = verifyAccessToken(raw); }
  catch { throw new AppError(401, 'Sesión de dispositivo no válida', 'RESTAURANT_ELECTRONIC_WAITER_AUTH_INVALID'); }
  if (!payload?.userId || !payload?.tenantId || payload.authType !== 'WAITER_DEVICE' || !payload.deviceId) {
    throw new AppError(401, 'La sesión no corresponde a un dispositivo Mesero', 'RESTAURANT_ELECTRONIC_WAITER_DEVICE_REQUIRED');
  }
  const subdomain = String(req.get('x-tenant-subdomain') || '').trim().toLowerCase();
  if (!subdomain) throw new AppError(400, 'Falta el restaurante del dispositivo', 'TENANT_SUBDOMAIN_REQUIRED');
  const [tenant, user] = await Promise.all([
    prisma.tenant.findFirst({ where:{ id:payload.tenantId, subdomain, activo:true }, select:{ id:true, subdomain:true } }),
    prisma.user.findFirst({ where:{ id:payload.userId, tenantId:payload.tenantId, activo:true, rol:'MESERO' }, select:{ id:true, nombre:true, rol:true } })
  ]);
  if (!tenant) throw new AppError(403, 'La sesión no pertenece a este restaurante', 'AUTH_TENANT_MISMATCH');
  if (!user) throw new AppError(401, 'El mesero ya no está activo', 'RESTAURANT_ELECTRONIC_WAITER_INVALID');
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

router.get('/api/public/restaurante/qr/:token/pago-electronico', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await electronic.clientContext(req.params.token, visitToken(req)) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/qr/:token/pago-electronico/reportar', async (req, res, next) => {
  try {
    const cajaBancoId = String(req.body?.cajaBancoId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(cajaBancoId)) throw new AppError(400, 'Selecciona un medio de pago electrónico', 'RESTAURANT_ELECTRONIC_DESTINATION_REQUIRED');
    const reference = String(req.body?.reference || '').trim().slice(0, 160);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ ok:true, data:await electronic.reportPayment(req.params.token, visitToken(req), { cajaBancoId, reference }) });
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/pago-electronico/:reportId/stream', async (req, res, next) => {
  try {
    const verified = await visitPayments.verifyVisit(req.params.token, visitToken(req));
    const row = await prisma.trackingLink.findFirst({
      where:{ id:req.params.reportId, tenantId:verified.table.tenantId, originType:electronic.ORIGIN_TYPE, originId:verified.session.id }
    });
    if (!row) throw new AppError(404, 'Reporte de pago no encontrado', 'RESTAURANT_ELECTRONIC_REPORT_NOT_FOUND');
    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive', 'X-Accel-Buffering':'no'
    });
    res.flushHeaders?.();
    res.write('retry: 2500\n\n');
    let stopped = false;
    let last = null;
    let tick = 0;
    const poll = async () => {
      if (stopped || res.writableEnded || res.destroyed) return;
      try {
        const snapshot = await electronic.reportStatusById(verified.table.tenantId, req.params.reportId);
        const encoded = JSON.stringify(snapshot);
        tick += 1;
        if (encoded !== last) {
          last = encoded;
          sseWrite(res, snapshot.state === 'CONFIRMED' ? 'confirmed' : 'snapshot', snapshot);
        } else if (tick % KEEPALIVE_TICKS === 0) res.write(': keepalive\n\n');
        if (snapshot.state === 'CONFIRMED' || snapshot.state === 'REJECTED') { res.end(); return; }
      } catch { sseWrite(res, 'payment-error', { message:'No fue posible actualizar la confirmación del pago' }); }
      const timer = setTimeout(poll, CLIENT_WATCH_MS); timer.unref?.();
    };
    const stop = () => { stopped = true; };
    req.on('close', stop); req.on('aborted', stop);
    poll();
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/mesero-dispositivo/pagos-electronicos', async (req, res, next) => {
  try {
    const actor = await verifyWaiterDeviceRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:{ reports:await electronic.waiterReportsSnapshot(actor.tenantId, actor.userId) } });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/pagos-electronicos/:id/confirmar', async (req, res, next) => {
  try {
    const actor = await verifyWaiterDeviceRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await electronic.confirmPayment(actor.tenantId, actor.userId, req.params.id) });
  } catch (error) { next(error); }
});

function removeWaiterSubscriber(watcher, res) {
  watcher.subscribers.delete(res);
  if (watcher.subscribers.size) return;
  if (watcher.timer) clearTimeout(watcher.timer);
  waiterWatchers.delete(watcher.tenantId);
}

async function pollWaiterWatcher(watcher) {
  watcher.timer = null;
  if (!watcher.subscribers.size) { waiterWatchers.delete(watcher.tenantId); return; }
  watcher.tick += 1;
  const byWaiter = new Map();
  try {
    const waiterIds = [...new Set([...watcher.subscribers.values()].map((row) => row.waiterUserId))];
    for (const waiterId of waiterIds) byWaiter.set(waiterId, { reports:await electronic.waiterReportsSnapshot(watcher.tenantId, waiterId) });
    for (const [res, subscriber] of [...watcher.subscribers.entries()]) {
      if (res.writableEnded || res.destroyed) { watcher.subscribers.delete(res); continue; }
      const snapshot = byWaiter.get(subscriber.waiterUserId) || { reports:[] };
      const encoded = JSON.stringify(snapshot);
      if (encoded !== subscriber.lastPayload) { subscriber.lastPayload = encoded; sseWrite(res, 'snapshot', snapshot); }
      else if (watcher.tick % KEEPALIVE_TICKS === 0) res.write(': keepalive\n\n');
    }
  } catch {
    for (const [res] of watcher.subscribers) sseWrite(res, 'payment-error', { message:'Pagos electrónicos temporalmente no disponibles' });
  }
  if (!watcher.subscribers.size) { waiterWatchers.delete(watcher.tenantId); return; }
  watcher.timer = setTimeout(() => pollWaiterWatcher(watcher), WAITER_WATCH_MS); watcher.timer.unref?.();
}

function subscribeWaiter(tenantId, waiterUserId, res) {
  let watcher = waiterWatchers.get(tenantId);
  if (!watcher) { watcher = { tenantId, subscribers:new Map(), timer:null, tick:0 }; waiterWatchers.set(tenantId, watcher); }
  watcher.subscribers.set(res, { waiterUserId, lastPayload:null });
  if (!watcher.timer) { watcher.timer = setTimeout(() => pollWaiterWatcher(watcher), 0); watcher.timer.unref?.(); }
  return () => removeWaiterSubscriber(watcher, res);
}

router.get('/api/public/restaurante/mesero-dispositivo/pagos-electronicos/stream', async (req, res, next) => {
  try {
    const actor = await verifyWaiterDeviceRequest(req);
    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive', 'X-Accel-Buffering':'no'
    });
    res.flushHeaders?.(); res.write('retry: 3000\n\n');
    const unsubscribe = subscribeWaiter(actor.tenantId, actor.userId, res);
    req.on('close', unsubscribe); req.on('aborted', unsubscribe);
  } catch (error) { next(error); }
});

// Asset compuesto del QR: conserva exactamente las capas vigentes y añade, al final,
// la elección de medio de pago / reporte electrónico. Se monta antes del compositor V21.
router.get('/app/restaurant-qr-ui.js', async (_req, res, next) => {
  try {
    const [mobileFit, edgeFallback, visitUi, trackingUi, baseUi, callUi, paymentUi] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-mobile-fit.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-edge-fallback-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-visit-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-tracking-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-waiter-call-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-qr-electronic-payment-ui.js'), 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-QR-Payment', 'v22-electronic-confirmed-by-waiter');
    res.type('application/javascript').send(`${mobileFit}\n;${edgeFallback}\n;${visitUi}\n;${trackingUi}\n;${baseUi}\n;${callUi}\n;${paymentUi}`);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-electronic-payment-ui.js', async (_req, res, next) => {
  try {
    const ui = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-electronic-payment-ui.js'), 'utf8');
    res.set('Cache-Control', 'no-store'); res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('application/javascript').send(ui);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const baseHtml = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-pwa-v7.html'), 'utf8');
    const v14Html = waiterPwaV11(baseHtml);
    const html = v14Html
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V22)
      .replace('</body>', `<script src="/app/${WAITER_CALL_QUERY_V21}"></script><script src="/app/${WAITER_PAYMENT_QUERY_V22}"></script><!-- legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE} --></body>`);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-PWA', 'v22-electronic-payment');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/sw.js', async (_req, res, next) => {
  try {
    const baseSw = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-sw.js'), 'utf8');
    const runtimePatched = baseSw
      .replace('vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code', WAITER_CACHE_V22)
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V22);
    const callInjected = runtimePatched.replace(
      `'\/app\/${WAITER_RUNTIME_QUERY_V22}'`,
      `'\/app\/${WAITER_RUNTIME_QUERY_V22}',\n  '\/app\/${WAITER_CALL_QUERY_V21}',\n  '\/app\/${WAITER_PAYMENT_QUERY_V22}'`
    );
    res.set('Cache-Control', 'no-cache'); res.set('Service-Worker-Allowed', '/app/centro-de-control');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('application/javascript').send(`${callInjected}\n// legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE}\n`);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, runtime] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-session-v8.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-runtime-v7.js'), 'utf8')
    ]);
    const patchedRuntime = waiterRuntimeV14(runtime);
    res.set('Cache-Control', 'no-store'); res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('application/javascript').send(`${sessionBridge}\n;${patchedRuntime}`);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantElectronicPaymentPublicRouter:router,
  WAITER_RUNTIME_QUERY_V22,
  WAITER_PAYMENT_QUERY_V22,
  WAITER_CACHE_V22
};
