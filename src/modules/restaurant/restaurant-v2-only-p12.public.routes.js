'use strict';

const express = require('express');

const router = express.Router();
const HEADER_VALUE = 'p12-v2-only-runtime';
const SW_MARKER = 'VANTIX_RESTAURANT_V1_SW_RETIREMENT_P12';

const TARGETS = Object.freeze({
  controlCenter: '/app/centro-de-control-v2',
  waiter: '/app/centro-de-control/mesero-v2/',
  production: '/app/produccion-v2/'
});

const LEGACY_SW_RETIREMENT = `'use strict';
const MARKER='${SW_MARKER}';
const LEGACY_PREFIXES=['vantixgc-waiter-shell-','vantixgc-production-','vantixgc-restaurant-production-','vantixgc-restaurant-v1-'];
self.addEventListener('install',event=>{event.waitUntil(Promise.resolve());self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  try{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>LEGACY_PREFIXES.some(prefix=>key.startsWith(prefix))).map(key=>caches.delete(key)));
  }catch{}
  try{await self.clients.claim()}catch{}
  try{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){try{client.postMessage({type:MARKER,v1Runtime:false,v2Only:true})}catch{}}
  }catch{}
  try{await self.registration.unregister()}catch{}
})())});
`;

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V2-Only', HEADER_VALUE);
  res.set('X-VantixGC-Restaurant-V1-Runtime', 'disabled');
}

function querySuffix(req) {
  const index = String(req.originalUrl || '').indexOf('?');
  return index >= 0 ? String(req.originalUrl).slice(index) : '';
}

function redirectV2(req, res, target, source) {
  noStore(res);
  res.set('X-VantixGC-Restaurant-V1-Redirect-From', source);
  return res.redirect(307, `${target}${querySuffix(req)}`);
}

function retiredWorker(res, allowedScope) {
  noStore(res);
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', allowedScope);
  res.set('X-VantixGC-Restaurant-V1-Service-Worker', 'retired');
  return res.type('application/javascript; charset=utf-8').send(LEGACY_SW_RETIREMENT);
}

// Retire the two broad legacy workers before any V1/P10 router can serve them.
// The V2 workers use independent narrower scopes and are not deleted here.
router.get('/app/centro-de-control/sw.js', (_req, res) => retiredWorker(res, '/app/centro-de-control'));
router.get('/app/produccion/sw.js', (_req, res) => retiredWorker(res, '/app/produccion'));

// P12 is the final runtime boundary: all canonical Restaurant entrypoints resolve
// directly to native V2. No tenant launcher or P10 compatibility shell runs first.
router.get('/app/centro-de-control', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control'));
router.get('/app/restaurante', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'restaurante'));
router.get('/app/centro-de-control/mesero', (req, res) => redirectV2(req, res, TARGETS.waiter, 'mesero-canonical'));
router.get('/app/produccion', (req, res) => redirectV2(req, res, TARGETS.production, 'produccion-canonical'));

// Direct V1/P10 rescue URLs are no longer executable in normal SaaS runtime.
// Source code remains frozen in git so rollback requires an intentional code change.
router.get('/app/restaurante-v1', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'restaurante-v1'));
router.get('/app/centro-de-control-p10', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control-p10'));
router.get('/app/centro-de-control/mesero-v1', (req, res) => redirectV2(req, res, TARGETS.waiter, 'mesero-v1'));
router.get('/app/produccion-v1', (req, res) => redirectV2(req, res, TARGETS.production, 'produccion-v1'));
router.get('/app/centro-de-control-preview', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'centro-de-control-preview'));

// Migration/retirement control screens are historical after P12. Prevent operators
// from reopening the V1 decision surface and return them to the live V2 workspace.
router.get('/app/restaurante-v2/migracion', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'migracion-p10'));
router.get('/app/restaurante-v2/retiro-v1', (req, res) => redirectV2(req, res, TARGETS.controlCenter, 'retiro-v1-p11'));

module.exports = {
  HEADER_VALUE,
  SW_MARKER,
  TARGETS,
  LEGACY_SW_RETIREMENT,
  restaurantV2OnlyP12PublicRouter: router
};
