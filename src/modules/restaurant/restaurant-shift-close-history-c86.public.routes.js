'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');
const MARKER = 'VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86';

function sendAsset(res, file, contentType) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Shift-Close', 'c86');
  res.type(contentType).sendFile(path.join(WEB_ROOT, file));
}

router.get('/app/restaurante-v2/cierres', (_req, res) => sendAsset(res, 'restaurant-shift-close-history-c86.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-shift-close-history-c86.js', (_req, res) => sendAsset(res, 'restaurant-shift-close-history-c86.js', 'application/javascript; charset=utf-8'));

module.exports = {
  MARKER,
  restaurantShiftCloseHistoryC86PublicRouter: router
};