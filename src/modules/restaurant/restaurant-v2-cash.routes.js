'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-v2-cash.service');
const customerDisplay = require('./restaurant-customer-display-name.service');
const customerSaleLink = require('./restaurant-customer-sale-link.service');
const paymentMethods = require('./restaurant-payment-methods.service');

const router = express.Router();

function parse(schema, value, message = 'Datos de Caja V2 inválidos') {
  const result = schema.safeParse(value || {});
  if (!result.success) throw new AppError(400, message, 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const openShiftSchema = z.object({
  cajaBancoId: z.string().uuid(),
  saldoInicial: z.coerce.number().min(0).max(1000000000000).default(0)
});

const closeShiftSchema = z.object({
  saldoFinal: z.coerce.number().min(0).max(1000000000000)
});

const chargeSchema = z.object({
  paymentMethodId: z.string().min(1).max(100),
  tipAmount: z.coerce.number().min(0).max(1000000000000).optional().default(0),
  reference: z.string().trim().max(160).optional().nullable(),
  terceroId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().max(160).optional().default(customerDisplay.DEFAULT_CUSTOMER_NAME)
});

const receiptPrintSchema = z.object({
  sessionId: z.string().uuid()
});

const customerSchema = z.object({
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

router.get('/v2/caja', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.workspace(req.tenantId, req.user) }); }
  catch (error) { next(error); }
});

router.get('/v2/caja/mesas/:tableId', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.tableDetail(req.tenantId, req.user, req.params.tableId) }); }
  catch (error) { next(error); }
});

router.post('/v2/caja/turno/abrir', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await service.openShift(req.tenantId, req.user, parse(openShiftSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/v2/caja/turno/resumen', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.shiftSummary(req.tenantId, req.user) }); }
  catch (error) { next(error); }
});

router.post('/v2/caja/turno/cerrar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.closeShift(req.tenantId, req.user, parse(closeShiftSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/v2/caja/mesas/:tableId/cobrar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  const input = parse(chargeSchema, req.body);
  let stagedCustomerName = null;
  let stagedSaleCustomer = null;
  try {
    stagedCustomerName = await customerDisplay.stageCustomerNameForTable(req.tenantId, req.params.tableId, input.customerName);

    if (input.terceroId) {
      const methods = await paymentMethods.listMethods(req.tenantId);
      const method = methods.find((row) => row.id === input.paymentMethodId && row.active);
      if (method && method.kind !== 'CREDITO') {
        stagedSaleCustomer = await customerSaleLink.stageIdentifiedCustomerForTable(req.tenantId, req.params.tableId, input.terceroId);
      }
    }

    const data = await service.chargeWholeAccount(req.tenantId, req.user, req.params.tableId, input);
    res.json({
      ok: true,
      data: {
        ...data,
        customer: data.customer || stagedSaleCustomer?.customer || null,
        customerName: stagedCustomerName?.customerName || customerDisplay.normalizeCustomerName(input.customerName)
      }
    });
  } catch (error) {
    if (stagedSaleCustomer) await customerSaleLink.restoreIdentifiedCustomerIfDraft(stagedSaleCustomer).catch(() => {});
    if (stagedCustomerName) await customerDisplay.restoreCustomerNameIfDraft(stagedCustomerName).catch(() => {});
    next(error);
  }
});

router.post('/v2/caja/recibo/imprimir', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const input = parse(receiptPrintSchema, req.body, 'Datos de impresión inválidos');
    res.json({ ok: true, data: await service.queueReceiptPrint(req.tenantId, req.user, input.sessionId) });
  } catch (error) { next(error); }
});

router.get('/v2/caja/clientes', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listCustomers(req.tenantId, req.query.q) }); }
  catch (error) { next(error); }
});

router.post('/v2/caja/clientes', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try {
    const data = await service.createCustomer(req.tenantId, parse(customerSchema, req.body, 'Datos de cliente inválidos'));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

module.exports = {
  restaurantV2CashRouter: router,
  openShiftSchema,
  closeShiftSchema,
  chargeSchema,
  receiptPrintSchema,
  customerSchema
};
