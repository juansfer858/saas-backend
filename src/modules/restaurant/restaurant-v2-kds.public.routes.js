'use strict';

const express = require('express');
const path = require('node:path');
const push = require('../notifications/push-v65.service');
const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p6-kds-realtime-push';
const PUSH_V25_MARKER = 'VANTIX_RESTAURANT_PUSH_RUNTIME_V25';

function send(res,file,type){res.set('Cache-Control','no-store, max-age=0');res.set('X-VantixGC-Restaurant-V2-KDS',HEADER_VALUE);if(type)res.type(type);return res.sendFile(path.join(webRoot,file))}
router.get('/app/restaurante-v2/kds',(_req,res)=>send(res,'restaurant-v2-kds.html','html'));
router.get('/app/restaurant-v2-kds.js',(_req,res)=>send(res,'restaurant-v2-kds.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds-stations-v23.js',(_req,res)=>send(res,'restaurant-v2-kds-stations-v23.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds-printer-hybrid-v24.js',(_req,res)=>send(res,'restaurant-v2-kds-printer-hybrid-v24.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds.css',(_req,res)=>send(res,'restaurant-v2-kds.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-realtime.js',(_req,res)=>send(res,'vantix-tenant-realtime.js','application/javascript; charset=utf-8'));

// Push V25: the V65 browser client existed, but its public Firebase config and
// Service Worker were never exposed by the V2 public runtime. Keep this public:
// it contains only Firebase Web identifiers/VAPID public key, never server secrets.
router.get('/api/public/restaurante/push-v65/config',(_req,res)=>{
  res.set('Cache-Control','no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Push', 'v25-config');
  res.json({ ok:true, data:push.publicConfig() });
});
router.get('/app/restaurant-push-v65.js',(_req,res)=>send(res,'restaurant-push-v65.js','application/javascript; charset=utf-8'));
router.get('/app/push-v65-sw.js',(_req,res)=>{
  const cfg=push.publicConfig();
  const publicConfig=JSON.stringify(cfg.firebaseConfig || {});
  res.set('Cache-Control','no-store, max-age=0');
  res.set('Service-Worker-Allowed','/app/');
  res.set('X-VantixGC-Restaurant-Push','v25-service-worker');
  res.type('application/javascript; charset=utf-8');
  res.send(`'use strict';\n/* ${PUSH_V25_MARKER} */\nconst VANTIX_PUSH_ENABLED=${cfg.enabled ? 'true' : 'false'};\nconst VANTIX_FIREBASE_CONFIG=${publicConfig};\nif(VANTIX_PUSH_ENABLED){\n  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');\n  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');\n  firebase.initializeApp(VANTIX_FIREBASE_CONFIG);\n  const messaging=firebase.messaging();\n  messaging.onBackgroundMessage((payload)=>{\n    const data=payload&&payload.data||{};\n    const title=data.title||'VantixGC Restaurantes';\n    return self.registration.showNotification(title,{body:data.body||'Nueva actividad en el restaurante.',tag:data.deliveryId||data.eventCode||'vantixgc-restaurant',data:{deepLink:data.deepLink||'/app/centro-de-control'}});\n  });\n}\nself.addEventListener('notificationclick',(event)=>{\n  event.notification.close();\n  const deepLink=event.notification&&event.notification.data&&event.notification.data.deepLink||'/app/centro-de-control';\n  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then((rows)=>{\n    const target=new URL(deepLink,self.location.origin).href;\n    const existing=rows.find((row)=>row.url===target)||rows.find((row)=>row.url.startsWith(self.location.origin));\n    if(existing){existing.navigate&&existing.navigate(target);return existing.focus();}\n    return clients.openWindow(target);\n  }));\n});\n`);
});

module.exports = { HEADER_VALUE, PUSH_V25_MARKER, restaurantV2KdsPublicRouter:router };
