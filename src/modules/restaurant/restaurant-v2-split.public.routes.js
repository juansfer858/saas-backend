'use strict';

const express = require('express');
const path = require('path');

const router = express.Router();
const WEB_ROOT = path.resolve(__dirname, '../../web');

function sendAsset(res, file, contentType) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', contentType);
  res.set('X-VantixGC-Restaurant-V2-Split', 'p5-real-split-independent');
  return res.sendFile(path.join(WEB_ROOT, file));
}

router.get('/app/restaurante-v2/division', (req, res) => sendAsset(res, 'restaurant-v2-split.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-split.css', (req, res) => sendAsset(res, 'restaurant-v2-split.css', 'text/css; charset=utf-8'));
router.get('/app/restaurant-v2-split.js', (req, res) => sendAsset(res, 'restaurant-v2-split.js', 'application/javascript; charset=utf-8'));

module.exports = { restaurantV2SplitPublicRouter: router };