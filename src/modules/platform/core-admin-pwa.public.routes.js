'use strict';

const express = require('express');

const coreAdminPwaPublicRouter = express.Router();
const ADMIN_PWA_MARKER = 'VANTIXGC_ADMIN_PWA_V1';

const manifest = Object.freeze({
  id: '/app/',
  name: 'VantixGC Administración',
  short_name: 'VantixGC Admin',
  description: 'Panel administrativo VantixGC Super Core',
  lang: 'es-CO',
  start_url: '/app/dashboard',
  scope: '/app/',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone'],
  background_color: '#f4f4f5',
  theme_color: '#137a53',
  orientation: 'any',
  icons: [
    { src: '/app/admin-icon.svg', sizes: '192x192 512x512', type: 'image/svg+xml', purpose: 'any maskable' }
  ],
  shortcuts: [
    { name: 'Dashboard', short_name: 'Dashboard', url: '/app/dashboard' },
    { name: 'Inventarios / Kardex', short_name: 'Inventarios', url: '/app/inventario' },
    { name: 'Centro de control', short_name: 'Restaurante', url: '/app/centro-de-control' }
  ]
});

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="VantixGC Admin">
  <rect width="512" height="512" rx="112" fill="#137a53"/>
  <rect x="74" y="74" width="364" height="364" rx="96" fill="#ffffff"/>
  <path d="M154 174 256 354 358 174" fill="none" stroke="#137a53" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const serviceWorkerSource = `'use strict';
const MARKER='${ADMIN_PWA_MARKER}';
self.VantixGCAdminPwaV1=Object.freeze({version:'1.0.0',scope:'/app/',networkOnly:true,noAuthenticatedApiCache:true});
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(event)=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',(event)=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/platform/api/')||url.pathname.startsWith('/edge/api/')) return;
  event.respondWith(fetch(request));
});
// ${ADMIN_PWA_MARKER}
`;

coreAdminPwaPublicRouter.get('/app/admin-manifest.webmanifest', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/manifest+json').send(JSON.stringify(manifest));
});

coreAdminPwaPublicRouter.get('/app/admin-sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Service-Worker-Allowed', '/app/');
  res.set('X-VantixGC-Admin-PWA', 'v1-network-only');
  res.type('application/javascript').send(serviceWorkerSource);
});

coreAdminPwaPublicRouter.get('/app/admin-icon.svg', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').send(iconSvg);
});

module.exports = {
  ADMIN_PWA_MARKER,
  coreAdminPwaPublicRouter,
  manifest,
  iconSvg,
  serviceWorkerSource
};
