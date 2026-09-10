'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');
const V18_SCRIPT = '<script src="/app/restaurant-v2-cash-tender-v18.js?v=v18"></script>';

function headers(res, contentType) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', contentType);
  res.set('X-VantixGC-Restaurant-V2-Cash', 'p4-cash-independent');
}

function sendAsset(res, file, contentType) {
  headers(res, contentType);
  return res.sendFile(path.join(WEB_ROOT, file));
}

function sendPage(res) {
  headers(res, 'text/html; charset=utf-8');
  const source = fs.readFileSync(path.join(WEB_ROOT, 'restaurant-v2-cash.html'), 'utf8');
  const html = source.includes('restaurant-v2-cash-tender-v18.js')
    ? source
    : source.replace('</body>', `  ${V18_SCRIPT}\n</body>`);
  return res.send(html);
}

router.get('/app/restaurante-v2/caja', (req, res) => sendPage(res));
router.get('/app/restaurant-v2-cash.css', (req, res) => sendAsset(res, 'restaurant-v2-cash.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cash.js', (req, res) => sendAsset(res, 'restaurant-v2-cash.js', 'application/javascript; charset=utf-8'));

module.exports = { restaurantV2CashPublicRouter: router };
