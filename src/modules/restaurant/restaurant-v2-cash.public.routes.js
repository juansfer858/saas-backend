'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');
const PAYMENT_ADMIN_TAG = '<script src="/app/restaurant-v2-payment-methods-v77.js?v=v77"></script>';
const EMPTY_CLOSE_TAG = '<script src="/app/restaurant-v2-cash-close-empty-v80.js?v=v80.2"></script>';
const C86_CLOSE_CSS_TAG = '<link rel="stylesheet" href="/app/restaurant-shift-close-c86.css?v=86">';
const C86_CLOSE_TAG = '<script src="/app/restaurant-shift-close-c86-cash.js?v=86"></script>';
const C86_DASHBOARD_MARKER = 'VANTIX_RESTAURANT_SHIFT_CLOSURES_C86_DASHBOARD';
const C86_DASHBOARD_TAG = `<script src="/app/restaurant-shift-closures-c86-dashboard.js?v=86" data-c86-dashboard="${C86_DASHBOARD_MARKER}"></script>`;

function headers(res, contentType) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', contentType);
  res.set('X-VantixGC-Restaurant-V2-Cash', 'p4-cash-independent');
}

function sendAsset(res, file, contentType) {
  headers(res, contentType);
  return res.sendFile(path.join(WEB_ROOT, file));
}

function installClosuresDashboard(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/dashboard') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(C86_DASHBOARD_MARKER)) {
      const patched = source.includes('</body>') ? source.replace('</body>', `${C86_DASHBOARD_TAG}</body>`) : `${source}${C86_DASHBOARD_TAG}`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-Restaurant-Closures', 'c86-dashboard-entry');
    return originalSend(body);
  };
  return next();
}

async function sendCashHtml(_req, res, next) {
  try {
    let source = await fs.promises.readFile(path.join(WEB_ROOT, 'restaurant-v2-cash.html'), 'utf8');
    if (!source.includes(PAYMENT_ADMIN_TAG)) source = source.replace('</body>', `  ${PAYMENT_ADMIN_TAG}\n</body>`);
    if (!source.includes(EMPTY_CLOSE_TAG)) source = source.replace('</body>', `  ${EMPTY_CLOSE_TAG}\n</body>`);
    if (!source.includes(C86_CLOSE_CSS_TAG)) source = source.replace('</head>', `  ${C86_CLOSE_CSS_TAG}\n</head>`);
    if (!source.includes(C86_CLOSE_TAG)) source = source.replace('</body>', `  ${C86_CLOSE_TAG}\n</body>`);
    if (!source.includes('restaurant-v2-payment-methods-v77.js')) throw new Error('No fue posible montar el gestor B de métodos de pago');
    if (!source.includes('restaurant-v2-cash-close-empty-v80.js')) throw new Error('No fue posible montar el cierre sin consumo V80');
    if (!source.includes('restaurant-shift-close-c86-cash.js')) throw new Error('No fue posible montar C86 en Caja');
    headers(res, 'text/html; charset=utf-8');
    res.set('X-VantixGC-Restaurant-Payment-Methods', 'v77');
    res.set('X-VantixGC-Restaurant-Cash-Close-Empty', 'v80.2');
    res.set('X-VantixGC-Restaurant-Shift-Closures', 'c86-optional-print');
    return res.send(source);
  } catch (error) { return next(error); }
}

router.use(installClosuresDashboard);
router.get('/app/restaurante-v2/caja', sendCashHtml);
router.get('/app/cierres', (req, res) => sendAsset(res, 'restaurant-shift-closures-c86.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-cash.css', (req, res) => sendAsset(res, 'restaurant-v2-cash.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cash.js', (req, res) => sendAsset(res, 'restaurant-v2-cash.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-payment-methods-v77.js', (req, res) => sendAsset(res, 'restaurant-v2-payment-methods-v77.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-cash-close-empty-v80.js', (req, res) => sendAsset(res, 'restaurant-v2-cash-close-empty-v80.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-shift-close-c86.css', (req, res) => sendAsset(res, 'restaurant-shift-close-c86.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-shift-close-c86-cash.js', (req, res) => sendAsset(res, 'restaurant-shift-close-c86-cash.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-shift-closures-c86.css', (req, res) => sendAsset(res, 'restaurant-shift-closures-c86.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-shift-closures-c86.js', (req, res) => sendAsset(res, 'restaurant-shift-closures-c86.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-shift-closures-c86-dashboard.js', (req, res) => sendAsset(res, 'restaurant-shift-closures-c86-dashboard.js', 'application/javascript; charset=utf-8'));

module.exports = { restaurantV2CashPublicRouter: router, installClosuresDashboard };
