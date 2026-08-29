'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const delivery = require('./restaurant-delivery.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de domicilio inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const itemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(99),
  notes: z.string().trim().max(240).optional().nullable()
});

const createSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(7).max(30),
  address: z.string().trim().min(5).max(200),
  neighborhood: z.string().trim().max(100).optional().nullable(),
  deliveryReference: z.string().trim().max(180).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  deliveryFee: z.coerce.number().min(0).max(1000000).optional().default(0),
  promisedAt: z.string().datetime().optional().nullable(),
  channel: z.enum(['MANUAL', 'WEB', 'WHATSAPP']).optional().default('MANUAL'),
  items: z.array(itemSchema).min(1).max(100)
});

const routeSchema = z.object({
  courierName: z.string().trim().max(120).optional().nullable()
});

const paymentSchema = z.object({
  metodoPago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']),
  cajaBancoId: z.string().uuid(),
  referencia: z.string().trim().max(180).optional().nullable()
});

router.get('/domicilios/resumen', requirePermission('DOMICILIOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.summary(req.tenantId) }); }
  catch (error) { next(error); }
});

router.get('/domicilios/clientes/telefono/:phone', requirePermission('DOMICILIOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.recentCustomerByPhone(req.tenantId, req.params.phone) }); }
  catch (error) { next(error); }
});

router.get('/domicilios', requirePermission('DOMICILIOS.VER'), async (req, res, next) => {
  try {
    res.json({
      ok: true,
      data: await delivery.listDeliveries(req.tenantId, {
        state: req.query.state || undefined,
        paymentStatus: req.query.paymentStatus || undefined,
        activeOnly: String(req.query.activeOnly || '').toLowerCase() === 'true',
        limit: req.query.limit
      })
    });
  } catch (error) { next(error); }
});

router.get('/domicilios/:id', requirePermission('DOMICILIOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.loadDelivery(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/domicilios', requirePermission('DOMICILIOS.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await delivery.createDelivery(req.tenantId, req.user, parse(createSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/domicilios/:id/aceptar', requirePermission('DOMICILIOS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.acceptDelivery(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/domicilios/:id/en-camino', requirePermission('DOMICILIOS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.markOnRoute(req.tenantId, req.user, req.params.id, parse(routeSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/domicilios/:id/entregado', requirePermission('DOMICILIOS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.markDelivered(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/domicilios/:id/pago', requirePermission('DOMICILIOS.PAGAR'), requirePermission('TESORERIA.PAGAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.registerDeliveryPayment(req.tenantId, req.user, req.params.id, parse(paymentSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/domicilios/:id/cancelar', requirePermission('DOMICILIOS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await delivery.cancelDelivery(req.tenantId, req.user, req.params.id) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantDeliveryRouter: router };
