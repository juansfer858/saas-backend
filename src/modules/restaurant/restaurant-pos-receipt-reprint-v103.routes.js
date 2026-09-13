'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const reprint = require('./restaurant-pos-receipt-reprint-v103.service');

const router = express.Router();

router.get('/ventas/:saleId/reimpresion-tirilla', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await reprint.eligibility(req.tenantId, req.params.saleId);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

router.post('/ventas/:saleId/reimprimir-tirilla', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await reprint.queueReceiptReprint(req.tenantId, req.user, req.params.saleId);
    if (!data.queued) {
      const status = data.reason === 'SALE_NOT_FOUND' ? 404 : 409;
      return res.status(status).json({
        ok: false,
        error: {
          code: data.reason || 'POS_RECEIPT_REPRINT_NOT_AVAILABLE',
          message: data.reason === 'SALE_NOT_PAID'
            ? 'La venta todavía tiene saldo pendiente.'
            : data.reason === 'NOT_RESTAURANT_POS_SALE'
              ? 'Este documento no pertenece a una venta POS liquidada del restaurante.'
              : data.reason === 'NO_PHYSICAL_PRINTER'
                ? 'No hay una impresora física POS configurada.'
                : data.reason === 'AMBIGUOUS_PHYSICAL_PRINTERS'
                  ? 'Hay varias impresoras físicas y ninguna está definida para Caja/Documentos.'
                  : 'La tirilla no está disponible para reimpresión.'
        },
        data
      });
    }
    return res.status(202).json({ ok: true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantPosReceiptReprintV103Router: router };
