'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-self-service.service');
const installClarity = require('./restaurant-install-clarity.service');
const windowsInstaller = require('../public-installer/windows-installer-v27.service');

const publicRouter = express.Router();
const tenantRouter = express.Router();
const registrationWindows = new Map();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de autoservicio inválidos', 'SELF_SERVICE_VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function rateLimitRegistration(req) {
  const key = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const current = registrationWindows.get(key);
  if (!current || now - current.startedAt > 3600000) {
    registrationWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= 5) throw new AppError(429, 'Demasiados registros desde esta conexión. Intenta más tarde.', 'SELF_SERVICE_RATE_LIMIT');
  current.count += 1;
}

function publicBaseUrl(req) {
  const configured = String(process.env.CORE_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

const registerSchema = z.object({
  restaurantName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  phone: z.string().trim().max(40).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  department: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase().default('CO'),
  currency: z.string().trim().length(3).toUpperCase().default('COP')
});
const profileSchema = z.object({
  restaurantName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(250).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  department: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase().optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'Envía al menos un dato' });
const tablesSchema = z.object({ count: z.coerce.number().int().min(1).max(50) });
const installClaimSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  pointCode: z.string().trim().min(2).max(50).optional()
});
const consumeSchema = z.object({
  token: z.string().trim().min(30).max(200),
  deviceName: z.string().trim().max(160).optional().nullable()
});

publicRouter.post('/register', async (req, res, next) => {
  try {
    rateLimitRegistration(req);
    const data = await service.registerRestaurant(parse(registerSchema, req.body || {}));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

publicRouter.post('/install-claims/consume', async (req, res, next) => {
  try {
    const input = parse(consumeSchema, req.body || {});
    res.json({ ok: true, data: await installClarity.consumeInstallClaim(input.token, input.deviceName || null) });
  } catch (error) { next(error); }
});

publicRouter.get('/instalador/:token.cmd', (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (token.length < 30) throw new AppError(404, 'Instalador no encontrado', 'INSTALLER_NOT_FOUND');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="INSTALAR_VANTIXGC_RESTAURANTES.cmd"');
    res.type('text/plain').send(windowsInstaller.claimInstallerCmd(token, publicBaseUrl(req)));
  } catch (error) { next(error); }
});

publicRouter.get('/instalador/:token.ps1', (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (token.length < 30) throw new AppError(404, 'Instalador no encontrado', 'INSTALLER_NOT_FOUND');
    res.set('Cache-Control', 'no-store');
    res.type('text/plain').send(windowsInstaller.claimInstallerPowerShell(token, publicBaseUrl(req)));
  } catch (error) { next(error); }
});

tenantRouter.get('/subscription', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getSubscription(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.get('/onboarding', async (req, res, next) => {
  try { res.json({ ok: true, data: await installClarity.getOnboarding(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.put('/onboarding/profile', async (req, res, next) => {
  try {
    const profile = parse(profileSchema, req.body || {});
    const data = await service.updateOnboarding(req.tenantId, { profile, completeStep: 'BUSINESS', currentStep: 'TABLES' });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

tenantRouter.post('/onboarding/tables', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.configureTables(req.tenantId, parse(tablesSchema, req.body || {}).count) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/onboarding/menu/starter', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.seedStarterMenu(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/onboarding/menu/skip', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.skipStarterMenu(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/onboarding/install-claim', async (req, res, next) => {
  try {
    const input = parse(installClaimSchema, req.body || {});
    const data = await service.createInstallClaim(req.tenantId, req.userId, input);
    await installClarity.noteInstallerGenerated(req.tenantId);
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

tenantRouter.post('/onboarding/site/defer', async (req, res, next) => {
  try { res.json({ ok: true, data: await installClarity.deferSiteInstallation(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/onboarding/complete', async (req, res, next) => {
  try { res.json({ ok: true, data: await installClarity.completeOnboarding(req.tenantId) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantSelfServicePublicRouter: publicRouter, restaurantSelfServiceTenantRouter: tenantRouter };
