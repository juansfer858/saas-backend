'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { waiterPwaV11 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WAITER_RUNTIME_QUERY_V18 = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v18-waiter-call-resume';
const WAITER_CACHE_V18 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v18-waiter-call-resume';
const LEGACY_RUNTIME_REFERENCE = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14';

router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const baseHtml = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-pwa-v7.html'), 'utf8');
    const v14Html = waiterPwaV11(baseHtml);
    const html = v14Html
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V18)
      .replace('</body>', `<!-- legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE} --></body>`);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.set('X-VantixGC-Waiter-Call', 'v18-resume-snapshot');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/sw.js', async (_req, res, next) => {
  try {
    const baseSw = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-sw.js'), 'utf8');
    const sw = `${baseSw
      .replace(
        "vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code",
        WAITER_CACHE_V18
      )
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V18)}\n// legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE}\n`;
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/app/centro-de-control');
    res.set('X-VantixGC-Waiter-Call', 'v18-resume-snapshot');
    res.type('application/javascript').send(sw);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantWaiterCallRefreshPublicRouter: router,
  WAITER_RUNTIME_QUERY_V18,
  WAITER_CACHE_V18,
  LEGACY_RUNTIME_REFERENCE
};
