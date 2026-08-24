const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const platform = require('./edge-platform.service');

const router = express.Router();
const remoteHtmlPath = path.join(__dirname, '..', '..', 'web', 'edge-remote-order.html');

const orderSchema = z.object({
  customerName: z.string().trim().max(120).optional().nullable(),
  customerPhone: z.string().trim().max(40).optional().nullable(),
  deliveryAddress: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  paymentMode: z.enum(['CASH', 'MANUAL_EXTERNAL_PENDING']).optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.coerce.number().positive().max(999),
    notes: z.string().trim().max(300).optional().nullable()
  })).min(1).max(100)
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Pedido remoto inválido', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

router.get('/:token', async (req, res, next) => {
  try {
    // Validate before serving the shell so revoked/rotated tokens fail closed.
    await platform.getRemoteContext(req.params.token);
    noStore(res);
    res.type('html').send(await fs.promises.readFile(remoteHtmlPath, 'utf8'));
  } catch (error) { next(error); }
});

router.get('/:token/context', async (req, res, next) => {
  try {
    noStore(res);
    res.json({ ok: true, data: await platform.getRemoteContext(req.params.token) });
  } catch (error) { next(error); }
});

router.post('/:token/orders', async (req, res, next) => {
  try {
    noStore(res);
    const order = await platform.createRemoteOrder(req.params.token, parse(orderSchema, req.body || {}));
    res.status(201).json({
      ok: true,
      data: {
        id: order.id,
        channelType: order.channelType,
        state: order.state,
        quotedTotal: order.quotedTotal,
        creadoEn: order.creadoEn
      }
    });
  } catch (error) { next(error); }
});

module.exports = { edgeRemotePublicRouter: router };
