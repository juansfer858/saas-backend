'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const HEADER_VALUE = 'p9-controlled-pilot';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Pilot', HEADER_VALUE);
  res.type(type).sendFile(path.join(webRoot, file));
}

router.get('/app/restaurante-v2/piloto', (_req, res) => send(res, 'restaurant-v2-pilot.html', 'html'));
router.get('/app/restaurant-v2-pilot.js', (_req, res) => send(res, 'restaurant-v2-pilot.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-pilot.css', (_req, res) => send(res, 'restaurant-v2-pilot.css', 'text/css; charset=utf-8'));

module.exports = { HEADER_VALUE, restaurantV2PilotPublicRouter: router };
