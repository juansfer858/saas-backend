const express = require('express');
const { z } = require('zod');
const service = require('./restaurant.service');
const { AppError } = require('../../utils/app-error');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Autopedido inválido', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const orderSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.coerce.number().positive().max(999),
    notes: z.string().trim().max(300).optional().nullable()
  })).min(1).max(100),
  confirmedTotal: z.coerce.number().min(0),
  customerPhoneE164: z.string().trim().max(30).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
});

router.get('/api/public/restaurante/qr/:token', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getQrContext(req.params.token) }); }
  catch (error) { next(error); }
});

router.post('/api/public/restaurante/qr/:token/pedidos', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.placeQrOrder(req.params.token, parse(orderSchema, req.body)) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantPublicRouter: router };
