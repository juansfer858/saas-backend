'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-waiter-device.service');
require('./restaurant-waiter-service-flex-v9');

const router = express.Router();
const pairHtml = path.join(__dirname, '../../web/restaurant-waiter-pair.html');
const waiterPwaV7Html = path.join(__dirname, '../../web/restaurant-waiter-pwa-v7.html');
const adminScript = path.join(__dirname, '../../web/restaurant-waiter-device-admin.js');
const performanceV6Script = path.join(__dirname, '../../web/restaurant-waiter-performance-v6.js');
const waiterRuntimeV7Script = path.join(__dirname, '../../web/restaurant-waiter-runtime-v7.js');
const waiterSessionV8Script = path.join(__dirname, '../../web/restaurant-waiter-session-v8.js');
const waiterReactiveV9Script = path.join(__dirname, '../../web/restaurant-waiter-reactive-v9.js');
const manifestFile = path.join(__dirname, '../../web/restaurant-waiter-manifest.webmanifest');
const swFile = path.join(__dirname, '../../web/restaurant-waiter-sw.js');
const iconFile = path.join(__dirname, '../../web/restaurant-waiter-icon.svg');
const icon192File = path.join(__dirname, '../../web/restaurant-waiter-icon-192.png');
const icon512File = path.join(__dirname, '../../web/restaurant-waiter-icon-512.png');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de vinculación inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const claimSchema = z.object({ token: z.string().trim().min(20).max(300), deviceName: z.string().trim().max(80).optional().nullable() });

router.get('/api/public/restaurante/mesero-dispositivo/vinculo', async (req, res, next) => {
  try { const token = String(req.query.t || '').trim(); if (!token) throw new AppError(400, 'Falta el código de vinculación', 'RESTAURANT_WAITER_PAIRING_TOKEN_REQUIRED'); res.json({ ok: true, data: await service.inspectPairing(token) }); } catch (error) { next(error); }
});
router.post('/api/public/restaurante/mesero-dispositivo/vincular', async (req, res, next) => {
  try { const input = parse(claimSchema, req.body || {}); const data = await service.claimPairing(input.token, { deviceName: input.deviceName, userAgent: req.get('user-agent') || '' }); res.status(201).json({ ok: true, data }); } catch (error) { next(error); }
});
router.get('/app/restaurant-waiter-device-admin.js', (_req, res) => { res.set('Cache-Control', 'no-store'); res.type('application/javascript').sendFile(adminScript); });
router.get('/app/restaurant-waiter-performance-v6.js', (_req, res) => { res.set('Cache-Control', 'no-store'); res.type('application/javascript').sendFile(performanceV6Script); });
router.get('/app/restaurant-waiter-runtime-v7.js', async (_req, res, next) => {
  try {
    const [sessionBridge, reactive, runtime] = await Promise.all([
      fs.promises.readFile(waiterSessionV8Script, 'utf8'),
      fs.promises.readFile(waiterReactiveV9Script, 'utf8'),
      fs.promises.readFile(waiterRuntimeV7Script, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Waiter-Runtime', 'v9-reactive-adaptive');
    res.type('application/javascript').send(`${sessionBridge}\n;${reactive}\n;${runtime}`);
  } catch (error) { next(error); }
});
router.get('/app/centro-de-control/conectar', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(pairHtml); });
router.get('/app/centro-de-control/mesero', (_req, res) => { res.set('Cache-Control', 'no-store'); res.set('X-VantixGC-Waiter-PWA', 'v9-reactive-persistent'); res.sendFile(waiterPwaV7Html); });
router.get('/app/centro-de-control/manifest.webmanifest', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('application/manifest+json').sendFile(manifestFile); });
router.get('/app/centro-de-control/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.set('Service-Worker-Allowed', '/app/centro-de-control'); res.type('application/javascript').sendFile(swFile); });
router.get('/app/centro-de-control/waiter-icon.svg', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/svg+xml').sendFile(iconFile); });
router.get('/app/centro-de-control/waiter-icon-192.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').sendFile(icon192File); });
router.get('/app/centro-de-control/waiter-icon-512.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').sendFile(icon512File); });

module.exports = { restaurantWaiterDevicePublicRouter: router };
