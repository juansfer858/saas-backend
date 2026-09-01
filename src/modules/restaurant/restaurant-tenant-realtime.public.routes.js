'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const visitPayments = require('./restaurant-visit-payments.service');
const realtime = require('../realtime/tenant-realtime.service');
const { waiterPwaV11, waiterRuntimeV14 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WAITER_RUNTIME_QUERY_V23 = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v23-tenant-realtime';
const WAITER_CALL_QUERY_V21 = 'restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request';
const WAITER_PAYMENT_QUERY_V22 = 'restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22';
const TENANT_REALTIME_QUERY_V1 = 'vantix-tenant-realtime.js?v=tenant-realtime-v1';
const WAITER_CACHE_V23 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v23-tenant-realtime';
const LEGACY_RUNTIME_REFERENCE = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14';

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

function eventMatchesVisit(event, verified) {
  const topics = Array.isArray(event?.topics) ? event.topics : [];
  if (!topics.some((topic) => topic === 'treasury' || topic.startsWith('restaurant'))) return false;
  const refs = event.refs || {};
  if (refs.sessionId && refs.sessionId !== verified.session.id) return false;
  if (refs.tableId && refs.tableId !== verified.table.id) return false;
  return true;
}

function patchTrackingRealtime(source) {
  const marker = 'window.VantixGCQrAccountRequestV1 = Object.freeze({';
  if (!source.includes(marker) || source.includes('VANTIX_QR_TENANT_REALTIME_V23')) return source;
  return source.replace(marker, `
  // VANTIX_QR_TENANT_REALTIME_V23: cualquier cambio confirmado de esta visita
  // dispara la lectura canónica ya existente; no duplica estado en el navegador.
  window.addEventListener('vantix:restaurant-visit-realtime', () => {
    refreshTracking().catch(() => {});
  });

  ${marker}`);
}

function patchRestaurantUiRealtime(source) {
  if (source.includes('VANTIX_RESTAURANT_TENANT_REALTIME_V23')) return source;
  let patched = source
    .replace("function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }", "function stopPoll() { S.poll = null; }")
    .replace("S.poll = setInterval(() => { if (S.tab === 'salon' && !S.salonEdit) renderSalon(true).catch(() => {}); }, S.context.polling.floorMs || 3000);", "S.poll = null;")
    .replace("S.poll=setInterval(()=>{if(S.tab==='mesero')refreshWaiterHistory(sessionId,tableId).catch(()=>{});},Math.max(Number(S.context.polling.floorMs||3000),2500));", "S.poll=null;")
    .replace("S.poll = setInterval(() => { if (S.tab === 'kds') renderKds(true).catch(() => {}); }, S.context.polling.kdsMs || 2000);", "S.poll = null;")
    .replace('Actualización automática cada ${seconds} s · En vivo', 'Sincronización instantánea · En vivo');

  const end = patched.lastIndexOf('})();');
  if (end < 0) return patched;
  const injection = `
  // VANTIX_RESTAURANT_TENANT_REALTIME_V23
  let tenantRealtimeRefreshTimer = null;
  let tenantRealtimePending = null;
  function tenantRealtimeRelevant(detail) {
    const topics = Array.isArray(detail?.topics) ? detail.topics : [];
    return topics.some((topic) => topic === 'treasury' || topic === 'commercial' || topic === 'inventory' || topic.startsWith('restaurant'));
  }
  async function tenantRealtimeRefreshNow() {
    tenantRealtimeRefreshTimer = null;
    const detail = tenantRealtimePending;
    tenantRealtimePending = null;
    if (!detail || !S.tab || S.dragging) {
      if (detail) {
        tenantRealtimePending = detail;
        tenantRealtimeRefreshTimer = setTimeout(tenantRealtimeRefreshNow, 180);
      }
      return;
    }
    try {
      if (S.tab === 'salon') await renderSalon(true);
      else if (S.tab === 'mesero') await renderWaiter();
      else if (S.tab === 'kds') await renderKds(true);
      else if (S.tab === 'caja') await renderCash();
    } catch {}
  }
  function queueTenantRealtimeRefresh(detail) {
    if (!tenantRealtimeRelevant(detail)) return;
    tenantRealtimePending = detail;
    if (tenantRealtimeRefreshTimer) return;
    tenantRealtimeRefreshTimer = setTimeout(tenantRealtimeRefreshNow, 70);
  }
  window.addEventListener('vantix:tenant-realtime', (event) => queueTenantRealtimeRefresh(event.detail || {}));
  window.addEventListener('vantix:tenant-realtime-ready', () => queueTenantRealtimeRefresh({ topics:['restaurant','treasury'] }));
  window.VantixGCRestaurantRealtimeV23 = Object.freeze({ version:'23.0.0', pushDriven:true, sharedWithCore:true, refresh:queueTenantRealtimeRefresh });
`;
  return `${patched.slice(0, end)}${injection}\n${patched.slice(end)}`;
}

function patchWaiterRuntimeRealtime(source) {
  if (source.includes('VANTIX_WAITER_TENANT_REALTIME_V23')) return source;
  const marker = 'window.VantixGCWaiterV7 = Object.freeze({';
  if (!source.includes(marker)) return source;
  return source.replace(marker, `
  // VANTIX_WAITER_TENANT_REALTIME_V23: el fallback existente sigue siendo sólo
  // recuperación; los cambios normales llegan por el bus del tenant y se leen ya.
  function waiterRealtimeKick(detail) {
    const topics = Array.isArray(detail?.topics) ? detail.topics : [];
    if (!topics.some((topic) => topic === 'treasury' || topic.startsWith('restaurant'))) return;
    if (S.destroyed) return;
    if (S.pollTimer) clearTimeout(S.pollTimer);
    S.pollTimer = null;
    schedulePoll(0);
  }
  window.addEventListener('vantix:tenant-realtime', (event) => waiterRealtimeKick(event.detail || {}));
  window.addEventListener('vantix:tenant-realtime-ready', () => waiterRealtimeKick({ topics:['restaurant'] }));

  ${marker}`);
}

router.get('/app/vantix-tenant-realtime.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.join(webRoot, 'vantix-tenant-realtime.js'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Realtime', 'tenant-v1');
    res.type('application/javascript').send(source);
  } catch (error) { next(error); }
});

router.get('/app/core-realtime-panel-ui.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.join(webRoot, 'core-realtime-panel-ui.js'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Realtime', 'core-panel-v1');
    res.type('application/javascript').send(source);
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/qr/:token/realtime', async (req, res, next) => {
  try {
    const verified = await visitPayments.verifyVisit(req.params.token, visitToken(req));
    res.status(200);
    res.set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
      'X-VantixGC-Realtime':'restaurant-visit-v1'
    });
    res.flushHeaders?.();
    res.write('retry: 2500\n\n');
    sseWrite(res, 'ready', { sessionId:verified.session.id, tableId:verified.table.id, at:new Date().toISOString() });
    const unsubscribe = realtime.subscribeTenant(verified.table.tenantId, (event) => {
      if (eventMatchesVisit(event, verified)) sseWrite(res, 'change', event);
    });
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
  } catch (error) { next(error); }
});

// Operación Restaurante principal: sustituye los tres temporizadores de refresco de la UI
// por el mismo bus que consume el Core. No se cambia ninguna acción ni API de negocio.
router.get('/app/restaurant-ui.js', async (_req, res, next) => {
  try {
    const [base, bridge] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-ui.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'vantix-tenant-realtime.js'), 'utf8')
    ]);
    const patched = patchRestaurantUiRealtime(base);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Realtime', 'v23-tenant');
    res.type('application/javascript').send(`${patched}\n;${bridge}`);
  } catch (error) { next(error); }
});

// QR cliente: conserva exactamente V22 (visita, seguimiento, carta, llamado y pago)
// y suma sólo el canal de eventos de la visita.
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
    res.set('X-VantixGC-QR-Realtime', 'v23-tenant');
    res.type('application/javascript').send(`${mobileFit}\n;${edgeFallback}\n;${visitUi}\n;${patchTrackingRealtime(trackingUi)}\n;${baseUi}\n;${callUi}\n;${paymentUi}\n;${realtimeUi}`);
  } catch (error) { next(error); }
});

// PWA Mesero V23: V14/V16/V21/V22 permanecen intactos, pero el runtime recibe una
// señal inmediata del mismo stream del Core. El ciclo de 7 s queda sólo como recuperación.
router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const baseHtml = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-pwa-v7.html'), 'utf8');
    const v14Html = waiterPwaV11(baseHtml);
    const html = v14Html
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V23)
      .replace('</body>', `<script src="/app/${WAITER_CALL_QUERY_V21}"></script><script src="/app/${WAITER_PAYMENT_QUERY_V22}"></script><script src="/app/${TENANT_REALTIME_QUERY_V1}"></script><!-- legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE} --></body>`);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.set('X-VantixGC-Waiter-Call', 'v21-account-request');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.set('X-VantixGC-Waiter-Realtime', 'v23-tenant');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/sw.js', async (_req, res, next) => {
  try {
    const baseSw = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-sw.js'), 'utf8');
    const runtimePatched = baseSw
      .replace('vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code', WAITER_CACHE_V23)
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V23);
    const injected = runtimePatched.replace(
      `'/app/${WAITER_RUNTIME_QUERY_V23}'`,
      `'/app/${WAITER_RUNTIME_QUERY_V23}',\n  '/app/${WAITER_CALL_QUERY_V21}',\n  '/app/${WAITER_PAYMENT_QUERY_V22}',\n  '/app/${TENANT_REALTIME_QUERY_V1}'`
    );
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/app/centro-de-control');
    res.set('X-VantixGC-Waiter-Realtime', 'v23-tenant');
    res.type('application/javascript').send(`${injected}\n// legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE}\n`);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, runtime] = await Promise.all([
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-session-v8.js'), 'utf8'),
      fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-runtime-v7.js'), 'utf8')
    ]);
    const patchedRuntime = patchWaiterRuntimeRealtime(waiterRuntimeV14(runtime));
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Runtime', 'v14-review-hard-gate');
    res.set('X-VantixGC-Waiter-Call', 'v21-account-request');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.set('X-VantixGC-Waiter-Realtime', 'v23-tenant');
    res.type('application/javascript').send(`${sessionBridge}\n;${patchedRuntime}`);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantTenantRealtimePublicRouter:router,
  WAITER_RUNTIME_QUERY_V23,
  WAITER_CACHE_V23,
  patchRestaurantUiRealtime,
  patchWaiterRuntimeRealtime,
  patchTrackingRealtime,
  eventMatchesVisit
};
