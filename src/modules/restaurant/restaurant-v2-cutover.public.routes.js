'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { waiterPwaV11 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const HEADER_VALUE = 'p10-tenant-cutover';
const waiterV1Html = path.join(webRoot, 'restaurant-waiter-pwa-v7.html');
const productionV1Html = path.join(webRoot, 'restaurant-production-kds-v63.html');

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Cutover', HEADER_VALUE);
}
function sendAsset(res, file, type) {
  noStore(res);
  res.type(type).sendFile(path.join(webRoot, file));
}
function launcherHtml(target) {
  const label = target === 'production' ? 'Producción' : 'Mesero';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0D6B43"><title>VantixGC Restaurante · ${label}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f5f7f6;color:#17212b;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.box{width:min(520px,100%);padding:28px;border:1px solid #dbe3df;border-radius:20px;background:#fff;box-shadow:0 18px 50px rgba(15,23,42,.08);text-align:center}.spin{width:34px;height:34px;margin:0 auto 16px;border:4px solid #dce8e2;border-top-color:#0D6B43;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}small{font-weight:900;letter-spacing:.10em;color:#0D6B43}h1{margin:10px 0 8px;font-size:26px}p{margin:0;color:#64748b;line-height:1.5}</style></head><body data-cutover-target="${target}"><main class="box"><div class="spin"></div><small>VANTIXGC RESTAURANTES · P10</small><h1>${label}</h1><p>Verificando la versión operativa asignada a este restaurante…</p></main><script src="/app/restaurant-v2-cutover-launch.js?v=p10"></script></body></html>`;
}

router.get('/app/restaurante-v2/migracion', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-cutover.js', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-cutover.css', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cutover-launch.js', (_req, res) => sendAsset(res, 'restaurant-v2-cutover-launch.js', 'application/javascript; charset=utf-8'));

// Canonical device entrypoints become tenant-aware launchers. They never decide
// globally: the authenticated device session asks the P10 API which version is
// the default for its own tenant.
router.get('/app/centro-de-control/mesero', (_req, res) => {
  noStore(res);
  res.set('X-VantixGC-Restaurant-V2-Cutover-Launcher', 'waiter');
  res.type('html').send(launcherHtml('waiter'));
});
router.get('/app/produccion', (_req, res) => {
  noStore(res);
  res.set('X-VantixGC-Restaurant-V2-Cutover-Launcher', 'production');
  res.type('html').send(launcherHtml('production'));
});

// Explicit device rollback paths. These bypass P10 and serve the proven V1
// device pages directly, just like /app/restaurante-v1 does for the main shell.
router.get('/app/centro-de-control/mesero-v1', async (_req, res, next) => {
  try {
    const html = waiterPwaV11(await fs.promises.readFile(waiterV1Html, 'utf8'));
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Rollback', 'waiter-v1-direct');
    res.type('html').send(html);
  } catch (error) { next(error); }
});
router.get('/app/produccion-v1', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(productionV1Html, 'utf8');
    const rendered = html
      .replace(
        '</head>',
        '  <link rel="apple-touch-icon" href="/app/produccion/icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n</head>'
      )
      .replace(
        '</body>',
        '  <script src="/app/produccion/pwa-v71.js?v=production-pwa-v71"></script>\n</body>'
      );
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Rollback', 'production-v1-direct');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

module.exports = { HEADER_VALUE, restaurantV2CutoverPublicRouter: router, launcherHtml };
