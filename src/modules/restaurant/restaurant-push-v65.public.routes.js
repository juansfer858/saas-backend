'use strict';

const express = require('express');
const path = require('node:path');
const pushService = require('../notifications/push-v65.service');
const operationalPush = require('./restaurant-operational-push-v25.service');
const kdsPush = require('./restaurant-v2-kds-push.service');

const MARKER = 'VANTIX_RESTAURANT_PUSH_CORE_V65';
const OPERATIONAL_MARKER = 'VANTIX_RESTAURANT_OPERATIONAL_PUSH_V25';
const router = express.Router();
const clientPath = path.join(__dirname, '..', '..', 'web', 'restaurant-push-v65.js');

function serviceWorkerSource() {
  const config = pushService.publicConfig();
  const firebaseConfig = JSON.stringify(config.firebaseConfig || {});
  return `'use strict';\n` +
`const MARKER='VANTIX_RESTAURANT_PUSH_SW_V65';\n` +
`self.VantixRestaurantPushV65=Object.freeze({version:'65.0.0',provider:'FCM'});\n` +
`importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');\n` +
`importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');\n` +
`firebase.initializeApp(${firebaseConfig});\n` +
`const messaging=firebase.messaging();\n` +
`messaging.onBackgroundMessage((payload)=>{const d=payload&&payload.data||{};const title=d.title||'VantixGC';const options={body:d.body||'',tag:d.deliveryId||d.eventCode||'vantixgc',data:{deepLink:d.deepLink||'/app/centro-de-control'},renotify:true};return self.registration.showNotification(title,options)});\n` +
`self.addEventListener('notificationclick',(event)=>{event.notification.close();const target=(event.notification&&event.notification.data&&event.notification.data.deepLink)||'/app/centro-de-control';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then((rows)=>{for(const client of rows){try{const u=new URL(client.url);if(u.origin===self.location.origin){client.focus();if('navigate'in client)client.navigate(target);return}}catch{}}return clients.openWindow(target)}))});\n` +
`// ${MARKER}\n`;
}

router.get('/api/public/restaurante/push-v65/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok:true, data:pushService.publicConfig() });
});

router.get('/app/restaurant-push-v65.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Push', 'v65-client');
  res.type('application/javascript').sendFile(clientPath);
});

router.get('/app/push-v65-sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Service-Worker-Allowed', '/app/push-v65/');
  res.set('X-VantixGC-Restaurant-Push', 'v65-sw');
  res.type('application/javascript').send(serviceWorkerSource());
});

// V25 observa únicamente cuatro mutaciones públicas ya existentes. No altera sus
// validaciones ni su respuesta; después del 2xx dispara avisos best-effort fuera
// de la transacción operativa. Así Push nunca puede bloquear un pedido o una mesa.
router.use((req, res, next) => {
  if (String(req.method || '').toUpperCase() !== 'POST') return next();
  const match = String(req.path || '').match(/^\/api\/public\/restaurante\/qr\/([^/]+)\/(llamar-mesero|pedir-cuenta|pedidos|solicitar-apertura)\/?$/);
  if (!match) return next();
  let qrToken;
  try { qrToken = decodeURIComponent(match[1]); } catch { return next(); }
  const action = match[2];
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals.restaurantOperationalPushV25Data = body?.data ?? null;
    return originalJson(body);
  };
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const data = res.locals.restaurantOperationalPushV25Data || {};
    if (action === 'llamar-mesero') {
      void operationalPush.notifyWaiterCallFromQr(qrToken, data?.call?.id || null).catch(()=>{});
      return;
    }
    if (action === 'pedir-cuenta') {
      void operationalPush.notifyAccountRequestFromQr(qrToken).catch(()=>{});
      return;
    }
    if (action === 'solicitar-apertura') {
      void operationalPush.notifyTableOpenRequestFromQr(qrToken, data).catch(()=>{});
      return;
    }
    if (action === 'pedidos') {
      void (async () => {
        const context = await operationalPush.qrContext(qrToken);
        const tenantId = data?.tenantId || context?.table?.tenantId || null;
        const sessionId = data?.sessionId || context?.session?.id || null;
        const order = tenantId && sessionId ? { ...data, tenantId, sessionId } : data;
        await Promise.allSettled([
          operationalPush.notifyQrOrderFromOrder(order),
          tenantId && sessionId ? kdsPush.notifyLatestRound(tenantId, sessionId) : Promise.resolve(null)
        ]);
      })().catch(()=>{});
    }
  });
  return next();
});

const loader = `;(()=>{if(window.VANTIX_RESTAURANT_PUSH_CLIENT_V65)return;if(document.querySelector('script[data-vantix-push-v65]'))return;const s=document.createElement('script');s.src='/app/restaurant-push-v65.js?v=65';s.async=true;s.dataset.vantixPushV65='1';document.head.appendChild(s)})();`;

function installRestaurantPushV65(req, res, next) {
  if (req.method !== 'GET') return next();
  const jsTarget = req.path === '/app/restaurant-ui.js' || req.path === '/app/restaurant-waiter-runtime-v7.js';
  const htmlTarget = req.path === '/app/produccion';
  if (!jsTarget && !htmlTarget) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER) && !source.includes('restaurant-push-v65.js')) {
      let patched = source;
      if (jsTarget) patched = `${source}\n/* ${MARKER} */\n${loader}\n`;
      else if (htmlTarget) patched = source.includes('</body>')
        ? source.replace('</body>', `<script src="/app/restaurant-push-v65.js?v=65" data-vantix-push-v65="1"></script><!-- ${MARKER} --></body>`)
        : `${source}<script src="/app/restaurant-push-v65.js?v=65" data-vantix-push-v65="1"></script><!-- ${MARKER} -->`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Push', 'v65-core');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  OPERATIONAL_MARKER,
  restaurantPushV65PublicRouter:router,
  installRestaurantPushV65,
  serviceWorkerSource,
  loader
};
