'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-table-open-request.service');

const router = express.Router();
const openSchema = z.object({ guestCount:z.coerce.number().int().min(1).max(50).default(1) });

function parse(schema, value) {
  const result = schema.safeParse(value || {});
  if (!result.success) throw new AppError(400, 'Datos de apertura inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

router.get('/v2/solicitudes-apertura', requirePermission('MESAS.VER'), async (req,res,next) => {
  try { res.json({ ok:true, data:await service.listPending(req.tenantId) }); }
  catch (error) { next(error); }
});

router.post('/v2/solicitudes-apertura/:id/abrir', requirePermission('MESAS.CREAR'), async (req,res,next) => {
  try {
    const input = parse(openSchema, req.body);
    res.status(201).json({ ok:true, data:await service.openRequestedTable(req.tenantId, req.user, req.params.id, input.guestCount) });
  } catch (error) { next(error); }
});

router.post('/v2/solicitudes-apertura/:id/descartar', requirePermission('MESAS.EDITAR'), async (req,res,next) => {
  try { res.json({ ok:true, data:await service.dismissRequest(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantV2TableOpenRequestRouter:router };
