const express = require('express');
const { z } = require('zod');
const service = require('./restaurant.service');
const identity = require('./restaurant-identity.service');
const notifications = require('../notifications/notifications.service');
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
  consentWhatsApp: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
}).refine((x) => !x.consentWhatsApp || Boolean(x.customerPhoneE164), { message: 'El consentimiento WhatsApp requiere número celular', path: ['customerPhoneE164'] });

router.get('/api/public/restaurante/qr/:token', async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.publicQrContext(req.params.token) }); }
  catch (error) { next(error); }
});

router.post('/api/public/restaurante/qr/:token/pedidos', async (req, res, next) => {
  try {
    const input = parse(orderSchema, req.body);
    const order = await service.placeQrOrder(req.params.token, input);
    if (input.consentWhatsApp && input.customerPhoneE164) {
      await notifications.grantConsent(order.tenantId, null, {
        phoneE164: input.customerPhoneE164,
        scope: 'TRANSACTIONAL',
        source: 'RESTAURANT_QR',
        evidence: { orderId: order.id, explicitCheckbox: true, capturedAt: new Date().toISOString() }
      });
    }
    res.status(201).json({ ok: true, data: order });
  } catch (error) { next(error); }
});

module.exports = { restaurantPublicRouter: router };
