'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-cutover.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de migración V2 inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const updateSchema = z.object({
  enabled: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable()
});

async function restaurantV2CutoverPilotGuard(req, _res, next) {
  try {
    if (req.method !== 'PATCH' || req.path !== '/v2/piloto' || req.body?.enabled !== false) return next();
    const decision = await service.launchDecision(req.tenantId);
    if (decision.enabled) {
      throw new AppError(409, 'Primero vuelve a V1 como principal desde Migración V2 y luego desactiva el piloto', 'RESTAURANT_V2_CUTOVER_ACTIVE_PILOT_DISABLE_FORBIDDEN');
    }
    return next();
  } catch (error) { return next(error); }
}

router.get('/v2/cutover/launch', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.launchDecision(req.tenantId) });
  } catch (error) { next(error); }
});

router.get('/v2/cutover', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.getCutover(req.tenantId) });
  } catch (error) { next(error); }
});

router.patch('/v2/cutover', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(updateSchema, req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await service.setCutover(req.tenantId, req.userId, input) });
  } catch (error) { next(error); }
});

module.exports = { restaurantV2CutoverRouter: router, restaurantV2CutoverPilotGuard };
