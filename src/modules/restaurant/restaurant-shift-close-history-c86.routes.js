'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-shift-close-history-c86.service');

const router = express.Router();

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional().default(300)
});

const formatSchema = z.object({
  formato: z.enum(['pdf', 'excel', 'xls']),
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional().default(300)
});

const printSchema = z.object({
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional().default(300)
});

function parse(schema, value) {
  const parsed = schema.safeParse(value || {});
  if (!parsed.success) throw new AppError(400, 'Datos de cierres inválidos', 'RESTAURANT_SHIFT_CLOSE_VALIDATION_ERROR', parsed.error.flatten());
  return parsed.data;
}

function safeName(value) {
  return String(value || 'cierre').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'cierre';
}

function sendExport(res, file, fallbackName) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', file.mime);
  res.set('Content-Disposition', `attachment; filename="${safeName(file.title || fallbackName)}.${file.extension}"`);
  return res.send(file.buffer);
}

router.get('/v2/caja/cierres', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(querySchema, req.query);
    res.json({ ok: true, data: await service.listClosures(req.tenantId, input) });
  } catch (error) { next(error); }
});

router.get('/v2/caja/cierres/dia/:date', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(querySchema.pick({ tzOffsetMinutes: true }), req.query);
    res.json({ ok: true, data: await service.getDay(req.tenantId, req.user.id, req.params.date, input) });
  } catch (error) { next(error); }
});

router.get('/v2/caja/cierres/dia/:date/exportar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(formatSchema, req.query);
    const file = await service.exportDay(req.tenantId, req.user.id, req.params.date, input.formato, input);
    sendExport(res, file, `cierre-${req.params.date}`);
  } catch (error) { next(error); }
});

router.get('/v2/caja/cierres/:shiftId', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(querySchema.pick({ tzOffsetMinutes: true }), req.query);
    res.json({ ok: true, data: await service.getClosure(req.tenantId, req.user.id, req.params.shiftId, input) });
  } catch (error) { next(error); }
});

router.get('/v2/caja/cierres/:shiftId/exportar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(formatSchema, req.query);
    const file = await service.exportClosure(req.tenantId, req.user.id, req.params.shiftId, input.formato, input);
    sendExport(res, file, `cierre-${req.params.shiftId}`);
  } catch (error) { next(error); }
});

router.post('/v2/caja/cierres/:shiftId/imprimir', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(printSchema, req.body);
    res.json({ ok: true, data: await service.queuePrint(req.tenantId, req.user.id, req.params.shiftId, { ...input, origin: 'HISTORY' }) });
  } catch (error) { next(error); }
});

module.exports = {
  restaurantShiftCloseHistoryC86Router: router,
  querySchema,
  formatSchema,
  printSchema
};