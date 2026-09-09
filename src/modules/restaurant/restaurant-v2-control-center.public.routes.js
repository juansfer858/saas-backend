'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'v2-control-center-bridge-p6-5';

router.get('/app/centro-de-control', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(path.join(webRoot, 'restaurant.html'), 'utf8');
    const rendered = html
      .replace('<title>VantixGC Restaurante</title>', '<title>VantixGC Restaurante · Centro de control V2</title>')
      .replace('</head>', '  <link rel="stylesheet" href="/app/restaurant-control-center.css?v=operational-v1">\n</head>')
      .replace('</body>', '  <script src="/app/restaurant-control-center.js?v=operational-v1"></script>\n  <script src="/app/restaurant-v2-control-center-bridge.js?v=p6-5"></script>\n</body>');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-Restaurant-Control', HEADER_VALUE);
    res.set('X-VantixGC-Restaurant-Control-Engine', 'restaurant-ui-v1+v2-navigation');
    res.set('X-VantixGC-Restaurant-Control-Fallback', '/app/restaurante');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

router.get('/app/restaurant-v2-control-center-bridge.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Control', HEADER_VALUE);
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-v2-control-center-bridge.js'));
});

module.exports = { HEADER_VALUE, restaurantV2ControlCenterPublicRouter: router };
