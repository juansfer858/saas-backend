'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'restaurant-v2-menu-v1';
const SPOTLIGHT_MARKER = 'VANTIX_RESTAURANT_V2_MENU_SPOTLIGHT_V1';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Menu', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}

router.get('/app/restaurante-v2/carta', (_req, res) => {
  return send(res, 'restaurant-v2-menu.html', 'html');
});

router.get('/app/restaurant-v2-menu.css', (_req, res) => {
  return send(res, 'restaurant-v2-menu.css', 'text/css; charset=utf-8');
});

router.get('/app/restaurant-v2-menu-spotlight-v1.css', (_req, res) => {
  return send(res, 'restaurant-v2-menu-spotlight-v1.css', 'text/css; charset=utf-8');
});

router.get('/app/restaurant-v2-menu.js', (_req, res) => {
  return send(res, 'restaurant-v2-menu.js', 'application/javascript; charset=utf-8');
});

router.get('/app/restaurant-v2-menu-spotlight-v1.js', (_req, res) => {
  return send(res, 'restaurant-v2-menu-spotlight-v1.js', 'application/javascript; charset=utf-8');
});

module.exports = {
  HEADER_VALUE,
  SPOTLIGHT_MARKER,
  restaurantV2MenuPublicRouter: router
};
