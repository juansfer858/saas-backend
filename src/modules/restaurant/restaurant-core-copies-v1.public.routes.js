'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER = 'restaurant-core-copies-v1';

function send(res, file, kind) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Core-Copy', HEADER);
  if (kind) res.type(kind);
  return res.sendFile(path.join(webRoot, file));
}

router.get('/app/restaurante-v2/contabilidad', (_req, res) => {
  return send(res, 'restaurant-v2-accounting-core-v1.html', 'html');
});

router.get('/app/restaurante-v2/configuracion-avanzada', (_req, res) => {
  return send(res, 'restaurant-v2-advanced-config-core-v1.html', 'html');
});

module.exports = {
  HEADER,
  restaurantCoreCopiesV1PublicRouter: router
};
