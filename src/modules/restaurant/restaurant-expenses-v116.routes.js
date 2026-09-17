'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-expenses-v116.service');
require('./restaurant-close-sales-reconcile-v116');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de gasto inválidos', 'RESTAURANT_EXPENSE_VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const expenseSchema = z.object({
  concepto: z.string().trim().min(1).max(240),
  monto: z.coerce.number().positive().max(1000000000),
  medio: z.enum(['EFECTIVO','TRANSFERENCIA']),
  cajaBancoId: z.string().uuid().optional().nullable()
});

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function day(value) {
  if (!value) return service.businessDate();
  const result = daySchema.safeParse(String(value).slice(0,10));
  if (!result.success) throw new AppError(400, 'Fecha inválida', 'RESTAURANT_EXPENSE_DATE_INVALID');
  return result.data;
}

router.get('/gastos-v116/contexto', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try { res.json({ ok:true, data:await service.context(req.tenantId, req.userId) }); } catch (error) { next(error); }
});

router.get('/gastos-v116', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try { res.json({ ok:true, data:await service.listDay(req.tenantId, req.userId, day(req.query.date)) }); } catch (error) { next(error); }
});

router.post('/gastos-v116', requirePermission('TESORERIA.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok:true, data:await service.createExpense(req.tenantId, req.userId, parse(expenseSchema, req.body || {})) }); } catch (error) { next(error); }
});

router.get('/reportes/ventas-dia-v116.xls', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const report = await service.dailySalesReport(req.tenantId, req.userId, day(req.query.date));
    res.set('Content-Type','application/vnd.ms-excel; charset=utf-8');
    res.set('Content-Disposition',`attachment; filename="${report.filename}"`);
    res.set('Cache-Control','no-store');
    res.set('X-VantixGC-Restaurant-Daily-Sales', 'v116');
    res.send(report.buffer);
  } catch (error) { next(error); }
});

module.exports = { restaurantExpensesV116Router:router };
