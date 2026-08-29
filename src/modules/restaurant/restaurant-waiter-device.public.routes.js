'use strict';

const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-waiter-device.service');

const router = express.Router();
const pairHtml = path.join(__dirname, '../../web/restaurant-waiter-pair.html');
const waiterPwaHtml = path.join(__dirname, '../../web/restaurant-waiter-pwa.html');
const adminScript = path.join(__dirname, '../../web/restaurant-waiter-device-admin.js');
const manifestFile = path.join(__dirname, '../../web/restaurant-waiter-manifest.webmanifest');
const swFile = path.join(__dirname, '../../web/restaurant-waiter-sw.js');
const iconFile = path.join(__dirname, '../../web/restaurant-waiter-icon.svg');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de vinculación inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const claimSchema = z.object({
  token: z.string().trim().min(20).max(300),
  deviceName: z.string().trim().max(80).optional().nullable()
});

router.get('/api/public/restaurante/mesero-dispositivo/vinculo', async (req, res, next) => {
  try {
    const token = String(req.query.t || '').trim();
    if (!token) throw new AppError(400, 'Falta el código de vinculación', 'RESTAURANT_WAITER_PAIRING_TOKEN_REQUIRED');
    res.json({ ok: true, data: await service.inspectPairing(token) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/mesero-dispositivo/vincular', async (req, res, next) => {
  try {
    const input = parse(claimSchema, req.body || {});
    const data = await service.claimPairing(input.token, { deviceName: input.deviceName, userAgent: req.get('user-agent') || '' });
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

// The normal Control Center stays owned by the proven legacy route. This middleware only
// appends the isolated device-management UI after that route renders the page.
router.get('/app/centro-de-control', (_req, res, next) => {
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string' && body.includes('</body>') && !body.includes('restaurant-waiter-device-admin.js')) {
      body = body.replace('</body>', '  <script src="/app/restaurant-waiter-device-admin.js?v=waiter-pwa-v1"></script>\n</body>');
    }
    return originalSend(body);
  };
  next();
});

router.get('/app/restaurant-waiter-device-admin.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(adminScript);
});

router.get('/app/centro-de-control/conectar', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(pairHtml);
});

router.get('/app/centro-de-control/mesero', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Waiter-PWA', 'v1');
  res.sendFile(waiterPwaHtml);
});

router.get('/app/centro-de-control/manifest.webmanifest', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(manifestFile);
});

router.get('/app/centro-de-control/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/app/centro-de-control');
  res.type('application/javascript').sendFile(swFile);
});

router.get('/app/centro-de-control/waiter-icon.svg', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/svg+xml').sendFile(iconFile);
});

module.exports = { restaurantWaiterDevicePublicRouter: router };
