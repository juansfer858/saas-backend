'use strict';

const MARKER = 'VANTIX_RESTAURANT_PRODUCTION_PWA_V71';
const CACHE = 'vantixgc-production-shell-v71';
const START = '/app/produccion';
const SHELL = [
  START,
  '/app/produccion/manifest.webmanifest',
  '/app/produccion/pwa-v71.js',
  '/app/produccion/icon-192.png',
  '/app/produccion/icon-512.png'
];

self.VantixGCProductionPwaV71 = Object.freeze({
  marker: MARKER,
  version: '71.0.0',
  scope: '/app/produccion',
  shellOffline: true,
  apiCache: false,
  pairingTokenCache: false
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('vantixgc-production-shell-') && key !== CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nunca almacenar APIs autenticadas ni el QR/token de vinculación.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/platform/api/') || url.pathname.startsWith('/edge/api/')) return;
  if (url.pathname === '/app/produccion/conectar' || url.searchParams.has('t')) return;
  if (!url.pathname.startsWith('/app/produccion')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response?.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match(START);
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
