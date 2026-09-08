'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const productionDevices = require('./restaurant-production-device-v63.service');

const router = express.Router();
const employeesUi = path.join(__dirname, '../../web/restaurant-employees-ui.js');
const productionAdminUi = path.join(__dirname, '../../web/restaurant-production-device-admin-v63.js');
const productionPairHtml = path.join(__dirname, '../../web/restaurant-production-pair-v63.html');
const productionKdsHtml = path.join(__dirname, '../../web/restaurant-production-kds-v63.html');
const productionManifest = path.join(__dirname, '../../web/restaurant-production-v63.webmanifest');
const productionPwaRuntime = path.join(__dirname, '../../web/restaurant-production-pwa-v71.js');
const productionServiceWorker = path.join(__dirname, '../../web/restaurant-production-sw-v71.js');
const productionIcon192 = path.join(__dirname, '../../web/restaurant-production-icon-192.png');
const productionIcon512 = path.join(__dirname, '../../web/restaurant-production-icon-512.png');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de vinculación de producción inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const claimSchema = z.object({
  token: z.string().trim().min(20).max(300),
  deviceName: z.string().trim().max(80).optional().nullable()
});

router.get('/api/public/restaurante/produccion-dispositivo/vinculo', async (req, res, next) => {
  try {
    const token = String(req.query.t || '').trim();
    if (!token) throw new AppError(400, 'Falta el código de vinculación', 'RESTAURANT_PRODUCTION_PAIRING_TOKEN_REQUIRED');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await productionDevices.inspectPairing(token) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/produccion-dispositivo/vincular', async (req, res, next) => {
  try {
    const input = parse(claimSchema, req.body || {});
    const data = await productionDevices.claimPairing(input.token, { deviceName: input.deviceName, userAgent: req.get('user-agent') || '' });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/app/restaurant-employees-ui.js', async (_req, res, next) => {
  try {
    const [employees, productionAdmin] = await Promise.all([
      fs.promises.readFile(employeesUi, 'utf8'),
      fs.promises.readFile(productionAdminUi, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Production-Device', 'v63-admin');
    res.type('application/javascript').send(`${employees}\n;${productionAdmin}`);
  } catch (error) { next(error); }
});

router.get('/app/produccion/conectar', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Production-Device', 'v63-pair');
  res.sendFile(productionPairHtml);
});

router.get('/app/produccion', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(productionKdsHtml, 'utf8');
    const rendered = html
      .replace(
        '</head>',
        '  <link rel="apple-touch-icon" href="/app/produccion/icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n</head>'
      )
      .replace(
        '</body>',
        '  <script src="/app/produccion/pwa-v71.js?v=production-pwa-v71"></script>\n</body>'
      );
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Production-Device', 'v63-kds');
    res.set('X-VantixGC-Production-PWA', 'v71-installable');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

router.get('/app/produccion/manifest.webmanifest', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Production-PWA', 'v71-manifest');
  res.type('application/manifest+json').sendFile(productionManifest);
});

router.get('/app/produccion/pwa-v71.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Production-PWA', 'v71-runtime');
  res.type('application/javascript').sendFile(productionPwaRuntime);
});

router.get('/app/produccion/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Service-Worker-Allowed', '/app/produccion');
  res.set('X-VantixGC-Production-PWA', 'v71-service-worker');
  res.type('application/javascript').sendFile(productionServiceWorker);
});

router.get('/app/produccion/icon-192.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(productionIcon192);
});

router.get('/app/produccion/icon-512.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png').sendFile(productionIcon512);
});

module.exports = { restaurantEmployeesPublicRouter: router };
