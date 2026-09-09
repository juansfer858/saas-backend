'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-kds.service');

const router = express.Router();
const querySchema = z.object({ station:z.enum(['COCINA','BARRA','POSTRES']).optional(), limit:z.coerce.number().int().min(1).max(500).optional() });
const stateSchema = z.object({ state:z.enum(['EN_PREPARACION','LISTA','ENTREGADA']) });
function parse(schema,value){const parsed=schema.safeParse(value||{});if(!parsed.success)throw new AppError(400,'Datos KDS V2 inválidos','VALIDATION_ERROR',parsed.error.flatten());return parsed.data}

router.get('/v2/kds', requirePermission('COMANDAS.VER'), async (req,res,next) => {
  try { res.json({ ok:true, data:await service.workspace(req.tenantId, req.user, parse(querySchema, req.query)) }); }
  catch (error) { next(error); }
});
router.patch('/v2/kds/comandas/:id', requirePermission('COMANDAS.EDITAR'), async (req,res,next) => {
  try { const input=parse(stateSchema,req.body);res.json({ ok:true, data:await service.updateState(req.tenantId, req.user, req.params.id, input.state) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantV2KdsRouter:router };
