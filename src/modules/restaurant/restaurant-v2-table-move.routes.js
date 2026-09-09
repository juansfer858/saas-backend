'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-table-move.service');

const router = express.Router();
const schema = z.object({ destinationTableId: z.string().uuid() });

function parse(value) {
  const result = schema.safeParse(value || {});
  if (!result.success) throw new AppError(400, 'Mesa destino inválida', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

router.post('/mesas/:id/mover-v2', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try {
    const input = parse(req.body);
    res.json({ ok: true, data: await service.moveTableVisit(req.tenantId, req.user, req.params.id, input.destinationTableId) });
  } catch (error) { next(error); }
});

module.exports = { restaurantV2TableMoveRouter: router };
