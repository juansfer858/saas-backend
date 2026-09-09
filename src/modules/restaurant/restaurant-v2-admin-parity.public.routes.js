'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'qr-devices-parity-v1';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Admin-Parity', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}

router.get(['/app/restaurante-v2/qrs', '/app/restaurante-v2/dispositivos'], (_req, res) => {
  return send(res, 'restaurant-v2-admin-parity.html', 'html');
});

router.get('/app/restaurant-v2-admin-parity.css', (_req, res) => {
  return send(res, 'restaurant-v2-admin-parity.css', 'text/css; charset=utf-8');
});

router.get('/app/restaurant-v2-admin-parity.js', (_req, res) => {
  return send(res, 'restaurant-v2-admin-parity.js', 'application/javascript; charset=utf-8');
});

module.exports = {
  HEADER_VALUE,
  restaurantV2AdminParityPublicRouter: router
};
