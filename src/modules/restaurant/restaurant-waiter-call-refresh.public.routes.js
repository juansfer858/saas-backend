'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { waiterPwaV11 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WAITER_RUNTIME_QUERY_V17 = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v17-waiter-call';
const WAITER_CACHE_V17 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v17-waiter-call';

// Force the linked waiter PWA to request a new runtime URL after waiter-call rollout.
// This is intentionally before the existing waiter-device public router so previously
// installed tablets cannot remain pinned to the V14 URL cached before the call feature.
router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const baseHtml = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-pwa-v7.html'), 'utf8');
    const v14Html = waiterPwaV11(baseHtml);
    const html = v14Html.replace(
      'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14',
      WAITER_RUNTIME_QUERY_V17
    );
    res.set('Cache-Control', 'no-store');
    // Preserve the production gate marker and add an explicit waiter-call marker.
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.set('X-VantixGC-Waiter-Call', 'v17-refresh');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});

// Serve a changed Service Worker body/cache key so installed tablets actually install
// a fresh shell and pre-cache the V17 waiter-call runtime URL. The underlying V16 SW
// logic remains unchanged: API calls are never cached and navigation stays network-first.
router.get('/app/centro-de-control/sw.js', async (_req, res, next) => {
  try {
    const baseSw = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-sw.js'), 'utf8');
    const sw = baseSw
      .replace(
        "vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code",
        WAITER_CACHE_V17
      )
      .replace(
        'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14',
        WAITER_RUNTIME_QUERY_V17
      );
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/app/centro-de-control');
    res.set('X-VantixGC-Waiter-Call', 'v17-refresh');
    res.type('application/javascript').send(sw);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantWaiterCallRefreshPublicRouter: router,
  WAITER_RUNTIME_QUERY_V17,
  WAITER_CACHE_V17
};
