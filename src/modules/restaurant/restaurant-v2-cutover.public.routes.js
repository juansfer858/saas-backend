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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0D6B43"><title>VantixGC Restaurante · ${label}</title></head><body data-cutover-target="${target}"><main><h1>${label}</h1><p>Verificando la versión operativa asignada a este restaurante…</p></main><script src="/app/restaurant-v2-cutover-launch.js?v=p10"></script></body></html>`;
}
function injectCutoverChooser(html, target) {
  const marker = `VANTIX_RESTAURANT_V2_CUTOVER_LAUNCH_P10_${String(target).toUpperCase()}`;
  if (html.includes(marker)) return html;
  const bodyOpen = '<body>';
  if (!html.includes(bodyOpen)) throw new Error(`P10 no encontró <body> en ${target}`);
  const injected = `<body data-cutover-target="${target}"><div id="vantixP10LaunchGuard" data-marker="${marker}" style="position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;background:#f5f7f6;color:#17212b;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif"><div style="width:min(480px,100%);padding:24px;border:1px solid #dbe3df;border-radius:18px;background:#fff;text-align:center;box-shadow:0 18px 50px rgba(15,23,42,.08)"><b>VantixGC Restaurante</b><div style="margin-top:8px;color:#64748b;font-size:13px">Verificando versión operativa del restaurante…</div></div></div><script src="/app/restaurant-v2-cutover-launch.js?v=p10"></script>`;
  return html.replace(bodyOpen, injected);
}
function renderProductionV1(html) {
  return html
    .replace(
      '</head>',
      '  <link rel="apple-touch-icon" href="/app/produccion/icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n</head>'
    )
    .replace(
      '</body>',
      '  <script src="/app/produccion/pwa-v71.js?v=production-pwa-v71"></script>\n</body>'
    );
}

router.get('/app/restaurante-v2/migracion', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-cutover.js', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-cutover.css', (_req, res) => sendAsset(res, 'restaurant-v2-cutover.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cutover-launch.js', (_req, res) => sendAsset(res, 'restaurant-v2-cutover-launch.js', 'application/javascript; charset=utf-8'));

// Canonical device entrypoints keep the proven V1 HTML/headers as a compatibility
// envelope, but P10 inserts its tenant-aware chooser before the legacy runtime can be
// used. This preserves old clients/smokes while the authenticated tenant decides V1/V2.
router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const legacy = waiterPwaV11(await fs.promises.readFile(waiterV1Html, 'utf8'));
    const html = injectCutoverChooser(legacy, 'waiter');
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Launcher', 'waiter');
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.type('html').send(html);
  } catch (error) { next(error); }
});
router.get('/app/produccion', async (_req, res, next) => {
  try {
    const legacy = renderProductionV1(await fs.promises.readFile(productionV1Html, 'utf8'));
    const html = injectCutoverChooser(legacy, 'production');
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Launcher', 'production');
    res.set('X-VantixGC-Production-Device', 'v63-kds');
    res.set('X-VantixGC-Production-PWA', 'v71-installable');
    res.type('html').send(html);
  } catch (error) { next(error); }
});

// Explicit device rollback paths bypass P10 and serve the proven V1 pages directly.
router.get('/app/centro-de-control/mesero-v1', async (_req, res, next) => {
  try {
    const html = waiterPwaV11(await fs.promises.readFile(waiterV1Html, 'utf8'));
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Rollback', 'waiter-v1-direct');
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.type('html').send(html);
  } catch (error) { next(error); }
});
router.get('/app/produccion-v1', async (_req, res, next) => {
  try {
    const html = renderProductionV1(await fs.promises.readFile(productionV1Html, 'utf8'));
    noStore(res);
    res.set('X-VantixGC-Restaurant-V2-Cutover-Rollback', 'production-v1-direct');
    res.set('X-VantixGC-Production-Device', 'v63-kds');
    res.set('X-VantixGC-Production-PWA', 'v71-installable');
    res.type('html').send(html);
  } catch (error) { next(error); }
});

module.exports = { HEADER_VALUE, restaurantV2CutoverPublicRouter: router, launcherHtml, injectCutoverChooser, renderProductionV1 };
