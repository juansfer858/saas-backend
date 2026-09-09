'use strict';

const path=require('node:path');
const express=require('express');

const router=express.Router();
const webRoot=path.join(__dirname,'..','..','web');
const files=Object.freeze({
  waiterHtml:path.join(webRoot,'restaurant-v2-waiter-p8.html'),
  productionHtml:path.join(webRoot,'restaurant-v2-production-p8.html'),
  waiterManifest:path.join(webRoot,'restaurant-v2-waiter-p8.webmanifest'),
  productionManifest:path.join(webRoot,'restaurant-v2-production-p8.webmanifest'),
  waiterSw:path.join(webRoot,'restaurant-v2-waiter-sw-p8.js'),
  productionSw:path.join(webRoot,'restaurant-v2-production-sw-p8.js'),
  deviceSdk:path.join(webRoot,'restaurant-v2-device-sdk-p8.js'),
  deviceRealtime:path.join(webRoot,'restaurant-v2-device-realtime-p8.js'),
  devicePwa:path.join(webRoot,'restaurant-v2-device-pwa-p8.js')
});

function noStore(res){res.set('Cache-Control','no-store');res.set('X-VantixGC-Restaurant-V2-Device-PWA','p8-isolated')}
function script(res,file){noStore(res);res.type('application/javascript').sendFile(file)}
function waiterPage(_req,res){noStore(res);res.set('X-VantixGC-Restaurant-V2-Device','waiter-p8');res.type('text/html').sendFile(files.waiterHtml)}
function productionPage(_req,res){noStore(res);res.set('X-VantixGC-Restaurant-V2-Device','production-p8');res.type('text/html').sendFile(files.productionHtml)}

// Express is non-strict by default, so each root route serves both the slash and
// no-slash form. Avoid redirecting one form because that can self-match as 308.
router.get('/app/centro-de-control/mesero-v2',waiterPage);
router.get('/app/centro-de-control/mesero-v2/manifest.webmanifest',(_req,res)=>{res.set('Cache-Control','no-cache');res.set('X-VantixGC-Restaurant-V2-Device-PWA','p8-waiter-manifest');res.type('application/manifest+json').sendFile(files.waiterManifest)});
router.get('/app/centro-de-control/mesero-v2/sw.js',(_req,res)=>{res.set('Cache-Control','no-cache');res.set('Service-Worker-Allowed','/app/centro-de-control/mesero-v2/');res.set('X-VantixGC-Restaurant-V2-Device-PWA','p8-waiter-sw');res.type('application/javascript').sendFile(files.waiterSw)});

router.get('/app/produccion-v2',productionPage);
router.get('/app/produccion-v2/manifest.webmanifest',(_req,res)=>{res.set('Cache-Control','no-cache');res.set('X-VantixGC-Restaurant-V2-Device-PWA','p8-production-manifest');res.type('application/manifest+json').sendFile(files.productionManifest)});
router.get('/app/produccion-v2/sw.js',(_req,res)=>{res.set('Cache-Control','no-cache');res.set('Service-Worker-Allowed','/app/produccion-v2/');res.set('X-VantixGC-Restaurant-V2-Device-PWA','p8-production-sw');res.type('application/javascript').sendFile(files.productionSw)});

router.get('/app/restaurant-v2-device-sdk-p8.js',(_req,res)=>script(res,files.deviceSdk));
router.get('/app/restaurant-v2-device-realtime-p8.js',(_req,res)=>script(res,files.deviceRealtime));
router.get('/app/restaurant-v2-device-pwa-p8.js',(_req,res)=>script(res,files.devicePwa));

module.exports={restaurantV2DevicePwaP8PublicRouter:router};
