'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/require-permission');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-print-template.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Configuración de plantilla inválida', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const schema = z.object({
  itemAlign: z.enum(['LEFT', 'CENTER']).optional(),
  noteAlign: z.enum(['LEFT', 'CENTER']).optional(),
  seatAlign: z.enum(['LEFT', 'CENTER']).optional(),
  headerSize: z.enum(['NORMAL', 'DOUBLE']).optional(),
  itemSize: z.enum(['NORMAL', 'TALL', 'DOUBLE']).optional(),
  noteSize: z.enum(['NORMAL', 'TALL', 'DOUBLE']).optional(),
  showTopTime: z.boolean().optional(),
  showBottomDateTime: z.boolean().optional(),
  showTrace: z.boolean().optional(),
  showSeat: z.boolean().optional(),
  separatorStyle: z.enum(['DOUBLE', 'SINGLE', 'NONE']).optional(),
  blankLinesBetweenItems: z.coerce.number().int().min(0).max(2).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'Debe enviar al menos un cambio' });

router.get('/plantilla-impresion', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getPrintTemplate(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/plantilla-impresion', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.savePrintTemplate(req.tenantId, req.userId, parse(schema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/plantilla-impresion/restaurar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.resetPrintTemplate(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantPrintTemplateRouter: router, printTemplateSchema: schema };