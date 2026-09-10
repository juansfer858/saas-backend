'use strict';

const express = require('express');
const path = require('path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');

function sendAsset(res, file, contentType) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', contentType);
  res.set('X-VantixGC-Restaurant-V2-Cash', 'p4-cash-independent');
  return res.sendFile(path.join(WEB_ROOT, file));
}

router.get('/app/restaurante-v2/caja', (req, res) => sendAsset(res, 'restaurant-v2-cash.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-cash.css', (req, res) => sendAsset(res, 'restaurant-v2-cash.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-cash.js', (req, res) => sendAsset(res, 'restaurant-v2-cash.js', 'application/javascript; charset=utf-8'));

module.exports = { restaurantV2CashPublicRouter: router };