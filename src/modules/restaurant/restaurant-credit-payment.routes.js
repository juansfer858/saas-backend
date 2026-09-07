'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const credit = require('./restaurant-credit-payment.service');

const router = express.Router();

const quickCustomerSchema = z.object({
  tipoDocumento: z.string().trim().min(1).max(20).default('CC'),
  identificacion: z.string().trim().min(3).max(40),
  nombre: z.string().trim().min(2).max(160),
  telefono: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  cupoCredito: z.coerce.number().min(0).max(1000000000).optional().default(0),
  diasPlazo: z.coerce.number().int().min(0).max(3650).optional().default(0)
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'Datos de cliente inválidos', 'VALIDATION_ERROR', result.error.flatten());
  }
  return result.data;
}

// Alta rápida de cliente desde el modal de Crédito. Se limita a clientes y a los
// campos necesarios para cartera; no expone edición general de terceros.
router.post('/credito/clientes', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await credit.createCreditCustomer(req.tenantId, parse(quickCustomerSchema, req.body || {}));
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

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

// Se monta después del router canónico de Restaurante. Si cualquier validación
// posterior falla, restauramos el borrador antes de entregar el error al cliente.
async function restaurantCreditRollbackMiddleware(error, req, _res, next) {
  if (!req?.restaurantCreditPrepared) return next(error);
  try {
    await credit.restorePreparedCredit(req.tenantId, req.restaurantCreditPrepared);
  } catch (rollbackError) {
    console.error('RESTAURANT_CREDIT_ROLLBACK_FAILED', {
      tenantId: req.tenantId,
      saleId: req.restaurantCreditPrepared?.saleId,
      error: rollbackError?.message || rollbackError
    });
  }
  return next(error);
}

module.exports = {
  restaurantCreditPaymentRouter: router,
  restaurantCreditRollbackMiddleware
};
