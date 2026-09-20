'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'restaurant-inventory-bar-v1';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Inventory', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}

router.get('/app/restaurante-v2/inventario', (_req,res)=>send(res,'restaurant-v2-inventory-bar-v1.html','html'));
router.get('/app/restaurant-v2-inventory-bar-v1.css', (_req,res)=>send(res,'restaurant-v2-inventory-bar-v1.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-inventory-bar-v1.js', (_req,res)=>send(res,'restaurant-v2-inventory-bar-v1.js','application/javascript; charset=utf-8'));

module.exports = { HEADER_VALUE, restaurantInventoryBarV1PublicRouter:router };
