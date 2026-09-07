'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const credit = require('./restaurant-credit-payment.service');

const router = express.Router();

// Prepara el tercero/cartera antes de que la ruta canónica /mesas/:id/cerrar
// emita la venta. Para contado no interviene y deja pasar la petición intacta.
router.post('/mesas/:id/cerrar', requirePermission('RESTAURANTE.CERRAR'), async (req, _res, next) => {
  if (String(req.body?.formaPago || '').toUpperCase() !== 'CREDITO') return next();
  try {
    req.restaurantCreditPrepared = await credit.prepareCreditClose(
      req.tenantId,
      req.params.id,
      req.body?.terceroId
    );
    return next();
  } catch (error) {
    return next(error);
  }
});

module.exports = { restaurantCreditPaymentRouter: router };
