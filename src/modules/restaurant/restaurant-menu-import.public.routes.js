'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');

router.get('/app/restaurant-menu-import-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-menu-import-ui.js'));
});

module.exports = { restaurantMenuImportPublicRouter: router };
