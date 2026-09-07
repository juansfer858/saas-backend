'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/require-permission');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-credit-customer.service');

const router = express.Router();

const createSchema = z.object({
  tipoDocumento: z.string().trim().min(1).max(20),
  identificacion: z.string().trim().min(3).max(40),
  nombre: z.string().trim().min(2).max(160),
  razonSocial: z.string().trim().max(200).optional().nullable(),
  direccion: z.string().trim().max(250).optional().nullable(),
  telefono: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  cupoCredito: z.coerce.number().min(0).max(1000000000000).optional().default(0),
  diasPlazo: z.coerce.number().int().min(0).max(3650).optional().default(0)
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de cliente inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

router.get('/clientes-credito', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await service.listCreditCustomers(req.tenantId, { q:req.query.q, limit:req.query.limit });
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

router.post('/clientes-credito', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await service.createCreditCustomer(req.tenantId, parse(createSchema, req.body || {}));
    res.status(201).json({ ok:true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantCreditCustomerRouter: router, createSchema };
