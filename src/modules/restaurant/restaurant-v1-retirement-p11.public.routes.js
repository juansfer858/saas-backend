'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'p11-v1-retirement';

function send(res, file, type) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-V1-Retirement', HEADER_VALUE);
  res.type(type).sendFile(path.join(webRoot, file));
}

// Canonical Control Center becomes a tiny tenant-aware launcher. It never loads
// restaurant.html or restaurant-ui.js. P11 decides between the native V2 shell
// and the previous P10 compatibility shell after reading the authenticated tenant state.
router.get('/app/centro-de-control', (_req, res) => send(res, 'restaurant-v1-retirement-p11-launch.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v1-retirement-p11-launch.js', (_req, res) => send(res, 'restaurant-v1-retirement-p11-launch.js', 'application/javascript; charset=utf-8'));

// Native V2 shell. This is the normal operation target after P11 activation.
router.get('/app/centro-de-control-v2', (_req, res) => send(res, 'restaurant-v2-native-control-p11.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-native-control-p11.js', (_req, res) => send(res, 'restaurant-v2-native-control-p11.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v2-native-control-p11.css', (_req, res) => send(res, 'restaurant-v2-native-control-p11.css', 'text/css; charset=utf-8'));

// Existing independent admin/business modules get standalone hosts so they no
// longer need the V1 Restaurant shell to remain reachable.
router.get('/app/restaurante-v2/empleados', (_req, res) => send(res, 'restaurant-v2-employees-p11.html', 'text/html; charset=utf-8'));
router.get('/app/restaurante-v2/domicilios', (_req, res) => send(res, 'restaurant-v2-delivery-p11.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v2-module-host-p11.js', (_req, res) => send(res, 'restaurant-v2-module-host-p11.js', 'application/javascript; charset=utf-8'));

// P11 control plane is intentionally admin-only at the API layer. The public
// HTML contains no secret and cannot mutate state without the tenant JWT.
router.get('/app/restaurante-v2/retiro-v1', (_req, res) => send(res, 'restaurant-v1-retirement-p11.html', 'text/html; charset=utf-8'));
router.get('/app/restaurant-v1-retirement-p11.js', (_req, res) => send(res, 'restaurant-v1-retirement-p11.js', 'application/javascript; charset=utf-8'));
router.get('/app/restaurant-v1-retirement-p11.css', (_req, res) => send(res, 'restaurant-v1-retirement-p11.css', 'text/css; charset=utf-8'));

module.exports = { HEADER_VALUE, restaurantV1RetirementP11PublicRouter:router };
