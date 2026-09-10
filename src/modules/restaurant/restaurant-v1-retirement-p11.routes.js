'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v1-retirement-p11.service');

const router = express.Router();
const V2_ONLY_MARKER = 'VANTIX_RESTAURANT_V2_ONLY_P12';

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de retiro V1 inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const updateSchema = z.object({
  enabled: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable()
});

async function restaurantV1RetirementCutoverGuard(req, _res, next) {
  try {
    // P12 closes every operator-accessible path back to V1. The dormant source
    // remains in git, but restoring it now requires an intentional code rollback.
    if (req.method === 'PATCH' && req.body?.enabled === false && ['/v2/retiro-v1', '/v2/cutover', '/v2/piloto'].includes(req.path)) {
      throw new AppError(
        409,
        'V1 está desactivado por el corte final V2 ONLY. La reversión requiere un cambio de código controlado.',
        'RESTAURANT_V2_ONLY_P12_ROLLBACK_DISABLED',
        { marker: V2_ONLY_MARKER, v1Runtime:false, v2Only:true }
      );
    }

    if (req.method !== 'PATCH' || req.path !== '/v2/cutover' || req.body?.enabled !== false) return next();
    const decision = await service.launchDecision(req.tenantId);
    if (decision.enabled) {
      throw new AppError(409, 'Primero restaura compatibilidad P10 desde Retiro V1 y después puedes volver el cutover a V1', 'RESTAURANT_V1_RETIREMENT_ACTIVE_CUTOVER_DISABLE_FORBIDDEN');
    }
    return next();
  } catch (error) { return next(error); }
}

router.get('/v2/retiro-v1/launch', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await service.launchDecision(req.tenantId) });
  } catch (error) { next(error); }
});

router.get('/v2/retiro-v1', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await service.getState(req.tenantId) });
  } catch (error) { next(error); }
});

router.patch('/v2/retiro-v1', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(updateSchema, req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json({ ok:true, data:await service.setState(req.tenantId, req.userId, input) });
  } catch (error) { next(error); }
});

module.exports = { V2_ONLY_MARKER, restaurantV1RetirementP11Router:router, restaurantV1RetirementCutoverGuard };
