'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const publicRouter = read('src/modules/restaurant/restaurant.public.routes.js');
const visitRoutes = read('src/modules/restaurant/restaurant-visit.public.routes.js');
const trackingRoutes = read('src/modules/restaurant/restaurant-client-tracking.public.routes.js');
const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');
const qrUi = read('src/web/restaurant-qr-ui.js');

assert.match(publicRouter, /restaurantClientTrackingPublicRouter/);
assert.match(publicRouter, /router\.use\(restaurantClientTrackingPublicRouter\)/);
assert.match(visitRoutes, /restaurant-qr-tracking-ui\.js/);
assert.match(visitRoutes, /trackingUi/);

for (const token of [
  "'/api/public/restaurante/qr/:token/mis-pedidos'",
  "'/api/public/restaurante/qr/:token/mis-pedidos/stream'",
  'visitPayments.verifyVisit',
  "qrVisitDeviceId === deviceId",
  "'Content-Type': 'text/event-stream; charset=utf-8'",
  "'X-Accel-Buffering': 'no'",
  'WATCH_INTERVAL_MS = 1800',
  'DEVICE_REVOKED',
  'TABLE_CLOSED'
]) assert.ok(trackingRoutes.includes(token), `Tracking backend must contain ${token}`);

for (const token of [
  'MI PEDIDO ·',
  'VER SEGUIMIENTO',
  'EN PREPARACIÓN',
  'LISTO PARA SERVIR',
  '/mis-pedidos/stream',
  'TextDecoder',
  'AbortController',
  'AGREGAR OTRO PEDIDO'
]) assert.ok(trackingUi.includes(token), `Tracking UI must contain ${token}`);

assert.ok(!trackingRoutes.includes('setInterval'), 'Tracking backend must not use setInterval');
assert.ok(!trackingUi.includes('setInterval'), 'Tracking UI must not use setInterval');
assert.ok(!trackingUi.includes('MutationObserver'), 'Tracking UI must not use MutationObserver');
assert.match(qrUi, /ENVIAR PEDIDO A COCINA/);
assert.doesNotMatch(qrUi, /WhatsApp opcional/);
assert.doesNotMatch(qrUi, /consentWhatsApp/);

new Function(trackingUi);
require('../src/modules/restaurant/restaurant-client-tracking.public.routes');

console.log('RESTAURANT CLIENT LIVE ORDER TRACKING SSE SMOKE OK');
