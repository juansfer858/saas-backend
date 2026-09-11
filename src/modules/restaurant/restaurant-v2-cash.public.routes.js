'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');
const PAYMENT_ADMIN_TAG = '<script src="/app/restaurant-v2-payment-methods-v77.js?v=v77"></script>';
const EMPTY_CLOSE_TAG = '<script src="/app/restaurant-v2-cash-close-empty-v80.js?v=v80.2"></script>';

function headers(res, contentType) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', contentType);
  res.set('X-VantixGC-Restaurant-V2-Cash', 'p4-cash-independent');
}

function sendAsset(res, file, contentType) {
  headers(res, contentType);
  return res.sendFile(path.join(WEB_ROOT, file));
}

async function sendCashHtml(_req, res, next) {
  try {
    let source = await fs.promises.readFile(path.join(WEB_ROOT, 'restaurant-v2-cash.html'), 'utf8');
    if (!source.includes(PAYMENT_ADMIN_TAG)) source = source.replace('</body>', `  ${PAYMENT_ADMIN_TAG}\n</body>`);
    if (!source.includes(EMPTY_CLOSE_TAG)) source = source.replace('</body>', `  ${EMPTY_CLOSE_TAG}\n</body>`);
    if (!source.includes('restaurant-v2-payment-methods-v77.js')) throw new Error('No fue posible montar el gestor B de métodos de pago');
    if (!source.includes('restaurant-v2-cash-close-empty-v80.js')) throw new Error('No fue posible montar el cierre sin consumo V80');
    headers(res, 'text/html; charset=utf-8');
    res.set('X-VantixGC-Restaurant-Payment-Methods', 'v77');
    res.set('X-VantixGC-Restaurant-Cash-Close-Empty', 'v80.2');
    return res.send(source);
  } catch (error) { return next(error); }
}

router.get('/app/restaurante-v2/caja', sendCashHtml);
router.get('/app/restaurant-v2-cash.css', (req, res) => sendAsset(res, 'restaurant-v2-cash.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cash.js', (req, res) => sendAsset(res, 'restaurant-v2-cash.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-payment-methods-v77.js', (req, res) => sendAsset(res, 'restaurant-v2-payment-methods-v77.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-cash-close-empty-v80.js', (req, res) => sendAsset(res, 'restaurant-v2-cash-close-empty-v80.js', 'application/javascript; charset=utf-8'));

module.exports = { restaurantV2CashPublicRouter: router };
