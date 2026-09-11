'use strict';

const fs = require('node:fs');
const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'restaurant-v2-menu-v1';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Menu', HEADER_VALUE);
  if (type) res.type(type);
  return res.sendFile(path.join(webRoot, file));
}
router.get('/app/restaurante-v2/carta', (_req,res)=>{
  const html=fs.readFileSync(path.join(webRoot,'restaurant-v2-menu.html'),'utf8').replace('</body>','<script src="/app/restaurant-promo-image-editor-v28.js?v=v28"></script><script src="/app/restaurant-v2-menu-delete-v2.js?v=v2"></script></body>');
  res.set('Cache-Control','no-store, max-age=0');res.set('X-VantixGC-Restaurant-V2-Menu',HEADER_VALUE);res.type('html').send(html);
});
router.get('/app/restaurant-v2-menu.css', (_req,res)=>send(res,'restaurant-v2-menu.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-menu.js', (_req,res)=>send(res,'restaurant-v2-menu.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-menu-delete-v2.js', (_req,res)=>send(res,'restaurant-v2-menu-delete-v2.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-menu-category-selector-v14.js', (_req,res)=>send(res,'restaurant-v2-menu-category-selector-v14.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-menu-edit-v27.js', (_req,res)=>{res.set('X-VantixGC-Restaurant-Carta-Edit','v27');return send(res,'restaurant-v2-menu-edit-v27.js','application/javascript; charset=utf-8');});
router.get('/app/restaurant-promo-image-editor-v28.js', (_req,res)=>{res.set('X-VantixGC-Restaurant-Promo','image-popup-v28');return send(res,'restaurant-promo-image-editor-v28.js','application/javascript; charset=utf-8');});
module.exports={HEADER_VALUE,restaurantV2MenuPublicRouter:router};
