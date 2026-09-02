'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-visit-payments.service');
const splitReport = require('./restaurant-split-report.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');
const paymentMethods = require('./restaurant-payment-methods.service');
const treasury = require('../treasury/treasury.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de visita/cobro inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const splitAssignmentSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  saleDetailIds: z.array(z.string().uuid()).min(1).max(100)
});

const prepareSchema = z.object({
  mode: z.enum(['TOGETHER', 'EQUAL', 'BY_SEAT', 'BY_ITEM']),
  parts: z.coerce.number().int().min(2).max(50).optional(),
  assignments: z.array(splitAssignmentSchema).min(1).max(50).optional(),
  tipAmount: z.coerce.number().min(0).max(100000000).optional().default(0)
}).superRefine((value, ctx) => {
  if (value.mode === 'BY_ITEM' && (!value.assignments || !value.assignments.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Elegir productos requiere asignaciones', path: ['assignments'] });
  }
});

const paymentSchema = z.object({
  partKey: z.string().trim().regex(/^P\d{1,2}$/),
  metodoPago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']),
  cajaBancoId: z.string().uuid(),
  referencia: z.string().trim().max(160).optional().nullable()
});

const paymentMethodSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO']),
  cajaBancoId: z.string().uuid().optional().nullable(),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(100)
});

const equalSplit = z.object({ mode: z.literal('EQUAL'), parts: z.coerce.number().int().min(2).max(50) });
const itemSplit = z.object({
  mode: z.literal('BY_ITEM'),
  assignments: z.array(z.object({ name: z.string().trim().max(80).optional(), saleDetailIds: z.array(z.string().uuid()).min(1) })).min(2).max(50)
});
const noneSplit = z.object({ mode: z.literal('NONE') });
const closeWithMethodSchema = z.object({
  paymentMethodId: z.string().uuid(),
  reference: z.string().trim().max(160).optional().nullable(),
  tipAmount: z.coerce.number().min(0).max(100000000).optional().default(0),
  split: z.union([equalSplit, itemSplit, noneSplit]).optional().nullable()
});
const cashCloseSchema = z.object({ saldoFinal: z.coerce.number().min(0).max(1000000000) });

router.get('/metodos-pago', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await paymentMethods.listMethods(req.tenantId) }); }
  catch (error) { next(error); }
});

router.post('/metodos-pago', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await paymentMethods.saveMethod(req.tenantId, null, parse(paymentMethodSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.patch('/metodos-pago/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await paymentMethods.saveMethod(req.tenantId, req.params.id, parse(paymentMethodSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.delete('/metodos-pago/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await paymentMethods.deactivateMethod(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/mesas/:id/cerrar-con-metodo', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await paymentMethods.closeTableWithMethod(req.tenantId, req.user, req.params.id, parse(closeWithMethodSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.get('/mesas/:id/qr-visita', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.staffVisitStatus(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/mesas/:id/qr-visita/regenerar', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.rotateVisit(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

router.get('/mesas/:id/pagos-divididos', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.paymentSummary(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/mesas/:id/pagos-divididos/preparar', requirePermission('RESTAURANTE.CERRAR'), requirePermission('TESORERIA.PAGAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.preparePaymentPlan(req.tenantId, req.user, req.params.id, parse(prepareSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/mesas/:id/pagos-divididos', requirePermission('RESTAURANTE.CERRAR'), requirePermission('TESORERIA.PAGAR'), async (req, res, next) => {
  try {
    const data = await settlementFinalizer.registerPartPaymentFinalized(
      req.tenantId,
      req.user,
      req.params.id,
      parse(paymentSchema, req.body || {})
    );
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

// This router is mounted before the base Restaurant router. The enriched summary/close
// therefore becomes the canonical Caja surface while keeping the old service compatible.
router.get('/caja/turnos/:id/resumen', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await splitReport.cashShiftSummary(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/caja/turnos/:id/cerrar', requirePermission('TESORERIA.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(cashCloseSchema, req.body || {});
    const before = await splitReport.cashShiftSummary(req.tenantId, req.userId, req.params.id);
    const closed = await treasury.closeCashSession(req.tenantId, req.userId, req.params.id, { saldoFinal: input.saldoFinal });
    res.json({ ok: true, data: { before, closed } });
  } catch (error) { next(error); }
});

module.exports = { restaurantVisitPaymentsRouter: router };
