'use strict';

const CACHE = 'vantixgc-waiter-shell-v3';
const START = '/app/centro-de-control/mesero?view=mesero&pwa=1';
const SHELL = [
  START,
  '/app/restaurant-theme.css?v=la-riel-v1',
  '/app/restaurant-control-center.css?v=workspace-v8-salon',
  '/restaurantes/theme-v1.css',
  '/app/restaurant-theme.js?v=panel-font-v1',
  '/app/restaurant-ui.js?v=salon-qr-v2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('vantixgc-waiter-shell-') && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/app/centro-de-control') && !url.pathname.startsWith('/app/restaurant-') && !url.pathname.startsWith('/restaurantes/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
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
