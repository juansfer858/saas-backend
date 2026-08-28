'use strict';

const express = require('express');
const path = require('node:path');
const { z } = require('zod');
const visitPayments = require('./restaurant-visit-payments.service');
const notifications = require('../notifications/notifications.service');
const { AppError } = require('../../utils/app-error');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Autopedido inválido', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function visitToken(req) {
  return String(req.get('x-vantix-restaurant-visit') || '').trim();
}

const authorizeSchema = z.object({
  code: z.string().trim().regex(/^\d{4}$/, 'El código debe tener 4 dígitos'),
  seatNumber: z.coerce.number().int().min(1).max(50).default(1)
});

const seatSchema = z.object({ seatNumber: z.coerce.number().int().min(1).max(50) });

const orderSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.coerce.number().positive().max(20),
    notes: z.string().trim().max(300).optional().nullable()
  })).min(1).max(100),
  confirmedTotal: z.coerce.number().min(0),
  customerPhoneE164: z.string().trim().max(30).optional().nullable(),
  consentWhatsApp: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
}).refine((x) => !x.consentWhatsApp || Boolean(x.customerPhoneE164), { message: 'El consentimiento WhatsApp requiere número celular', path: ['customerPhoneE164'] });

router.get('/app/restaurant-qr-visit-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-qr-visit-ui.js'));
});

router.get('/app/restaurant-visit-payments-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-visit-payments-ui.js'));
});

router.get('/api/public/restaurante/qr/:token/visita', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data: await visitPayments.describeVisit(req.params.token, visitToken(req)) });
  } catch (error) { next(error); }
});

router.post('/api/public/restaurante/qr/:token/autorizar', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const input = parse(authorizeSchema, req.body || {});
    res.json({ ok: true, data: await visitPayments.authorizeVisit(req.params.token, input.code, input.seatNumber) });
  } catch (error) { next(error); }
});

router.patch('/api/public/restaurante/qr/:token/persona', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const input = parse(seatSchema, req.body || {});
    res.json({ ok: true, data: await visitPayments.changeVisitSeat(req.params.token, visitToken(req), input.seatNumber) });
  } catch (error) { next(error); }
});

// This route deliberately precedes the legacy QR-order handler. A photographed permanent QR
// may browse the menu, but cannot submit any order without a device token from the current visit.
router.post('/api/public/restaurante/qr/:token/pedidos', async (req, res, next) => {
  try {
    const input = parse(orderSchema, req.body || {});
    const order = await visitPayments.placeAuthorizedQrOrder(req.params.token, visitToken(req), input);
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

module.exports = { restaurantVisitPublicRouter: router };
