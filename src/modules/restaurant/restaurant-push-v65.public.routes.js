'use strict';

const express = require('express');
const path = require('node:path');
const pushService = require('../notifications/push-v65.service');

const MARKER = 'VANTIX_RESTAURANT_PUSH_CORE_V65';
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
  restaurantPushV65PublicRouter:router,
  installRestaurantPushV65,
  serviceWorkerSource,
  loader
};
