'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const ALERT_QUERY_V25 = 'restaurant-waiter-qr-order-alert-ui.js?v=waiter-qr-order-alert-v25';
const CACHE_V23 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v23-tenant-realtime';
const CACHE_V25 = 'vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v25-qr-order-alert';
const REALTIME_QUERY = 'vantix-tenant-realtime.js?v=tenant-realtime-v1';

router.get('/app/restaurant-waiter-qr-order-alert-ui.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.join(webRoot, 'restaurant-waiter-qr-order-alert-ui.js'), 'utf8');
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-QR-Order', 'v25-realtime');
    res.type('application/javascript').send(source);
  } catch (error) { next(error); }
});

function interceptSend(res, transform) {
  const original = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string') body = transform(body);
    return original(body);
  };
}

router.use('/app/centro-de-control/mesero', (_req, res, next) => {
  interceptSend(res, (html) => {
    if (html.includes(ALERT_QUERY_V25)) return html;
    return html.replace('</body>', `<script src="/app/${ALERT_QUERY_V25}"></script></body>`);
  });
  res.set('X-VantixGC-Waiter-QR-Order', 'v25-realtime');
  next();
});

router.use('/app/centro-de-control/sw.js', (_req, res, next) => {
  interceptSend(res, (source) => {
    let patched = source.replace(CACHE_V23, CACHE_V25);
    if (!patched.includes(ALERT_QUERY_V25)) {
      patched = patched.replace(`'/app/${REALTIME_QUERY}'`, `'/app/${REALTIME_QUERY}',\n  '/app/${ALERT_QUERY_V25}'`);
    }
    return `${patched}\n// VANTIX_WAITER_QR_ORDER_ALERT_V25\n`;
  });
  res.set('X-VantixGC-Waiter-QR-Order', 'v25-realtime');
  next();
});

module.exports = {
  restaurantQrOrderWaiterAlertPublicRouter:router,
  ALERT_QUERY_V25,
  CACHE_V25
};
