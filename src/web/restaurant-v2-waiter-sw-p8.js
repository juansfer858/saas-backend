'use strict';

const MARKER='VANTIX_RESTAURANT_WAITER_TABLET_3COL_V22';
const CACHE='vantixgc-restaurant-v2-waiter-v22';
const START='/app/centro-de-control/mesero-v2/';
const SHELL=[
  START,
  '/app/centro-de-control/mesero-v2/manifest.webmanifest',
  '/app/restaurant-v2-design-system.css',
  '/app/restaurant-v2-orders.css?v=v22',
  '/app/restaurant-v2-device-sdk-p8.js',
  '/app/restaurant-v2-device-realtime-p8.js',
  '/app/restaurant-v2-orders.js',
  '/app/restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request',
  '/app/restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22',
  '/app/restaurant-waiter-qr-order-alert-ui.js?v=waiter-qr-order-alert-v25',
  '/app/restaurant-v2-device-pwa-p8.js',
  '/app/centro-de-control/waiter-icon-192.png',
  '/app/centro-de-control/waiter-icon-512.png'
];
self.VantixGCRestaurantV2WaiterP8=Object.freeze({marker:MARKER,version:'22.0.0',scope:'/app/centro-de-control/mesero-v2/',tabletLayout:'MESAS_CARTA_REVISAR_PEDIDO',columns:3,apiCache:false,pairingTokenCache:false,realtimeCached:true,waiterCalls:true,accountRequests:true,electronicPaymentConfirmation:true,qrOrderAlerts:true});
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>null));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vantixgc-restaurant-v2-waiter-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/'))return;
  const shellRequest=url.pathname.startsWith('/app/centro-de-control/mesero-v2/')||url.pathname.startsWith('/app/restaurant-v2-')||url.pathname==='/app/restaurant-waiter-call-ui.js'||url.pathname==='/app/restaurant-waiter-electronic-payment-ui.js'||url.pathname==='/app/restaurant-waiter-qr-order-alert-ui.js';
  if(!shellRequest)return;
  event.respondWith((async()=>{try{const response=await fetch(request);if(response?.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone()).catch(()=>{})}return response}catch(error){const cached=await caches.match(request);if(cached)return cached;if(request.mode==='navigate'){const shell=await caches.match(START);if(shell)return shell}throw error}})());
});
