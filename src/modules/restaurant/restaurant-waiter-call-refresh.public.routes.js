'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { waiterPwaV11 } = require('./restaurant-waiter-device.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const WAITER_RUNTIME_QUERY_V22 = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v22-electronic-payment';
const WAITER_CALL_QUERY_V21 = 'restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request';
const WAITER_PAYMENT_QUERY_V22 = 'restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22';
const WAITER_CACHE_V22 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v22-electronic-payment';
const LEGACY_RUNTIME_REFERENCE = 'restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14';

router.get('/app/centro-de-control/mesero', async (_req, res, next) => {
  try {
    const baseHtml = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-pwa-v7.html'), 'utf8');
    const v14Html = waiterPwaV11(baseHtml);
    const html = v14Html
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V22)
      .replace('</body>', `<script src="/app/${WAITER_CALL_QUERY_V21}"></script><script src="/app/${WAITER_PAYMENT_QUERY_V22}"></script><!-- legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE} --></body>`);
    res.set('Cache-Control', 'no-store');
    // Compatibilidad: el shell base sigue siendo V14 y la capa de llamados sigue siendo V21.
    res.set('X-VantixGC-Waiter-PWA', 'v14-review-hard-gate-persistent');
    res.set('X-VantixGC-Waiter-Call', 'v21-account-request');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('text/html').send(html);
  } catch (error) { next(error); }
});

router.get('/app/centro-de-control/sw.js', async (_req, res, next) => {
  try {
    const baseSw = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-sw.js'), 'utf8');
    const runtimePatched = baseSw
      .replace(
        'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code',
        WAITER_CACHE_V22
      )
      .replace(LEGACY_RUNTIME_REFERENCE, WAITER_RUNTIME_QUERY_V22);
    const sw = `${runtimePatched.replace(
      `'\/app\/${WAITER_RUNTIME_QUERY_V22}'`,
      `'\/app\/${WAITER_RUNTIME_QUERY_V22}',\n  '\/app\/${WAITER_CALL_QUERY_V21}',\n  '\/app\/${WAITER_PAYMENT_QUERY_V22}'`
    )}\n// legacy-runtime-contract:${LEGACY_RUNTIME_REFERENCE}\n`;
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/app/centro-de-control');
    res.set('X-VantixGC-Waiter-Call', 'v21-account-request');
    res.set('X-VantixGC-Waiter-Payment', 'v22-electronic');
    res.type('application/javascript').send(sw);
  } catch (error) { next(error); }
});

module.exports = {
  restaurantWaiterCallRefreshPublicRouter: router,
  WAITER_RUNTIME_QUERY_V22,
  WAITER_CALL_QUERY_V21,
  WAITER_PAYMENT_QUERY_V22,
  WAITER_CACHE_V22,
  LEGACY_RUNTIME_REFERENCE
};
