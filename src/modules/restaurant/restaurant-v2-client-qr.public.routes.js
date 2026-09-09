'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p7-permanent-qr-client';
const MARKER = 'VANTIX_RESTAURANT_V2_CLIENT_QR_P7';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Client-QR', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}

// P7 owns the existing physical QR URL without changing the token contract.
// This router is mounted before every V1 QR wrapper. Removing this module makes
// src/app.js' existing /r/:token handler the automatic legacy fallback again.
router.get('/r/:token', (_req, res) => send(res, 'restaurant-v2-client-qr.html', 'html'));
router.get('/app/restaurant-v2-client-qr.js', (_req, res) => send(res, 'restaurant-v2-client-qr.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-client-qr.css', (_req, res) => send(res, 'restaurant-v2-client-qr.css', 'text/css; charset=utf-8'));

module.exports = {
  HEADER_VALUE,
  MARKER,
  restaurantV2ClientQrPublicRouter: router
};
