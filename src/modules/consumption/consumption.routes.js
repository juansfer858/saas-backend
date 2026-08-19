const express = require('express');
const { z } = require('zod');
const service = require('./consumption.service');
const { AppError } = require('../../utils/app-error');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de consumo inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const itemSchema = z.object({
  ingredientProductId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unitLabel: z.string().trim().max(30).optional().nullable()
});

const recipeSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(160),
  outputProductId: z.string().uuid().optional().nullable(),
  active: z.boolean().optional(),
  items: z.array(itemSchema).min(1)
});

const recipeUpdateSchema = recipeSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un cambio' });
const consumeSchema = z.object({
  quantity: z.coerce.number().positive().default(1),
  sourceType: z.string().trim().min(1).max(60).optional(),
  sourceId: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(120).optional().nullable(),
  fecha: z.coerce.date().optional()
});

router.get('/recetas', async (req, res, next) => {
  try {
    const filters = {
      active: req.query.active === undefined ? undefined : req.query.active === 'true',
      outputProductId: req.query.outputProductId,
      limit: req.query.limit
    };
    res.json({ ok: true, data: await service.listRecipes(req.tenantId, filters) });
  } catch (error) { next(error); }
});

router.post('/recetas', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createRecipe(req.tenantId, parse(recipeSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/recetas/:id', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getRecipe(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

router.patch('/recetas/:id', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.updateRecipe(req.tenantId, req.params.id, parse(recipeUpdateSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/recetas/:id/consumir', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.consumeRecipe(req.tenantId, req.userId, req.params.id, parse(consumeSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/ejecuciones/:sourceType/:sourceId', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getRunForSource(req.tenantId, req.params.sourceType, req.params.sourceId) }); }
  catch (error) { next(error); }
});

module.exports = { consumptionRouter: router };
