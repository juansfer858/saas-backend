'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/require-permission');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-inventory-bar-v1.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de inventario inválidos', 'RESTAURANT_INVENTORY_VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const productId = z.string().uuid();
const trackingSchema = z.object({ enabled:z.boolean() });
const minimumSchema = z.object({
  minimum:z.coerce.number().min(0).max(1000000000),
  version:z.coerce.number().int().min(1)
});
const movementSchema = z.object({
  productId,
  kind:z.enum(['initial','entry','exit','adjustment']),
  quantity:z.coerce.number().min(0).max(1000000000),
  reason:z.string().trim().min(1).max(400),
  version:z.coerce.number().int().min(1)
});
const purchaseItemSchema = z.object({
  productId,
  quantity:z.coerce.number().positive().max(1000000000),
  unitCost:z.coerce.number().positive().max(1000000000),
  taxPercent:z.coerce.number().min(0).max(100).default(0)
});
const purchaseSchema = z.object({
  id:z.string().uuid().optional(),
  supplierId:z.string().uuid().optional().nullable(),
  supplier:z.string().trim().min(1).max(200),
  reference:z.string().trim().max(160).optional().default(''),
  purchaseDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentTerms:z.enum(['cash','credit']),
  dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:z.string().trim().max(400).optional().default(''),
  items:z.array(purchaseItemSchema).min(1).max(200)
});

router.get('/inventario-v1', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.workspace(req.tenantId) }); }
  catch(error){ next(error); }
});

router.get('/inventario-v1/tracking', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.trackingMap(req.tenantId) }); }
  catch(error){ next(error); }
});

router.patch('/inventario-v1/productos/:productId/tracking', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req,res,next)=>{
  try {
    const id = parse(productId, req.params.productId);
    const input = parse(trackingSchema, req.body || {});
    res.json({ ok:true, data:await service.configureTracking(req.tenantId, req.userId, id, input.enabled) });
  } catch(error){ next(error); }
});

router.patch('/inventario-v1/productos/:productId/minimo', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req,res,next)=>{
  try {
    const id = parse(productId, req.params.productId);
    const input = parse(minimumSchema, req.body || {});
    res.json({ ok:true, data:await service.setMinimum(req.tenantId, req.userId, { productId:id, ...input }) });
  } catch(error){ next(error); }
});

router.post('/inventario-v1/movimientos', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.moveStock(req.tenantId, req.userId, parse(movementSchema, req.body || {})) }); }
  catch(error){ next(error); }
});

router.get('/inventario-v1/movimientos', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try {
    res.json({ ok:true, data:await service.history(req.tenantId, {
      productId:req.query.productId || null,
      from:req.query.from || null,
      to:req.query.to || null,
      before:req.query.before || null
    }) });
  } catch(error){ next(error); }
});

router.get('/inventario-v1/pedidos', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.purchaseList(req.tenantId) }); }
  catch(error){ next(error); }
});

router.get('/inventario-v1/pedidos/:id', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.purchaseDetail(req.tenantId, parse(productId, req.params.id)) }); }
  catch(error){ next(error); }
});

router.post('/inventario-v1/pedidos', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.savePurchase(req.tenantId, req.userId, parse(purchaseSchema, req.body || {})) }); }
  catch(error){ next(error); }
});

router.post('/inventario-v1/pedidos/:id/recibir', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.receivePurchase(req.tenantId, req.userId, parse(productId, req.params.id)) }); }
  catch(error){ next(error); }
});

router.get('/inventario-v1/productos/:productId/costos', requirePermission('RESTAURANTE.VER'), async (req,res,next)=>{
  try { res.json({ ok:true, data:await service.costHistory(req.tenantId, parse(productId, req.params.productId)) }); }
  catch(error){ next(error); }
});

module.exports = {
  restaurantInventoryBarV1Router:router,
  trackingSchema,
  minimumSchema,
  movementSchema,
  purchaseSchema
};
