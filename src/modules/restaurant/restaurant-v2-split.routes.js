'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-split.service');

const router = express.Router();

function parse(schema, body) {
  const result = schema.safeParse(body || {});
  if (!result.success) throw new AppError(400, 'Datos de División V2 inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const assignmentSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  saleDetailIds: z.array(z.string().uuid()).min(1).max(100)
});

const prepareSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('EQUAL'), parts: z.coerce.number().int().min(2).max(50) }),
  z.object({ mode: z.literal('BY_SEAT') }),
  z.object({ mode: z.literal('BY_ITEM'), assignments: z.array(assignmentSchema).min(2).max(50) })
]);

const partPaymentSchema = z.object({
  partKey: z.string().trim().regex(/^P\d{1,2}$/),
  paymentMethodId: z.string().min(1).max(100),
  reference: z.string().trim().max(120).optional().nullable()
});

router.get('/v2/division', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.workspace(req.tenantId, req.user) }); }
  catch (error) { next(error); }
});

router.get('/v2/division/mesas/:tableId', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.detailSummary(req.tenantId, req.user, req.params.tableId) }); }
  catch (error) { next(error); }
});

router.post('/v2/division/mesas/:tableId/preparar', requirePermission('RESTAURANTE.CERRAR'), requirePermission('TESORERIA.PAGAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.prepare(req.tenantId, req.user, req.params.tableId, parse(prepareSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/v2/division/mesas/:tableId/pagar', requirePermission('RESTAURANTE.CERRAR'), requirePermission('TESORERIA.PAGAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.payPart(req.tenantId, req.user, req.params.tableId, parse(partPaymentSchema, req.body)) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantV2SplitRouter: router, prepareSchema, partPaymentSchema };