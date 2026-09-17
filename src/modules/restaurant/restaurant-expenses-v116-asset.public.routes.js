'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { runtime, MARKER } = require('./restaurant-expenses-v116.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');

// restaurant-ui.js is served with sendFile, so response-send wrappers cannot reliably
// append V116. The control-center asset is already loaded by the Restaurant shell;
// own that exact asset here and append only the isolated V116 runtime.
router.get('/app/restaurant-control-center.js', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.join(webRoot, 'restaurant-control-center.js'), 'utf8');
    const body = source.includes(MARKER) ? source : `${source}\n;${runtime}\n`;
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Expenses', 'v116-asset');
    res.type('application/javascript').send(body);
  } catch (error) { next(error); }
});

module.exports = { restaurantExpensesV116AssetPublicRouter: router };
