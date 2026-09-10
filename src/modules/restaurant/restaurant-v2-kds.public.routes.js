'use strict';

const express = require('express');
const path = require('node:path');
const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p6-kds-realtime-push';

function send(res,file,type){res.set('Cache-Control','no-store, max-age=0');res.set('X-VantixGC-Restaurant-V2-KDS',HEADER_VALUE);if(type)res.type(type);return res.sendFile(path.join(webRoot,file))}
router.get('/app/restaurante-v2/kds',(_req,res)=>send(res,'restaurant-v2-kds.html','html'));
router.get('/app/restaurant-v2-kds.js',(_req,res)=>send(res,'restaurant-v2-kds.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds-stations-v23.js',(_req,res)=>send(res,'restaurant-v2-kds-stations-v23.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds-printer-hybrid-v24.js',(_req,res)=>send(res,'restaurant-v2-kds-printer-hybrid-v24.js','application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-kds.css',(_req,res)=>send(res,'restaurant-v2-kds.css','text/css; charset=utf-8'));
router.get('/app/restaurant-v2-realtime.js',(_req,res)=>send(res,'vantix-tenant-realtime.js','application/javascript; charset=utf-8'));

module.exports = { HEADER_VALUE, restaurantV2KdsPublicRouter:router };
