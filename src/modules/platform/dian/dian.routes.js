const express = require('express');
const { z } = require('zod');
const service = require('./dian.service');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos DIAN inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const configSchema = z.object({
  providerCode: z.string().trim().min(2).max(80),
  providerName: z.string().trim().min(2).max(160),
  environment: z.enum(['HABILITACION', 'PRODUCCION']),
  habilitacionBaseUrl: z.string().url().optional().nullable(),
  produccionBaseUrl: z.string().url().optional().nullable(),
  credentials: z.record(z.string(), z.any()).optional(),
  certificateAlias: z.string().trim().max(160).optional().nullable(),
  certificateExpiresAt: z.coerce.date().optional().nullable(),
  certificateFingerprint: z.string().trim().max(200).optional().nullable(),
  invoiceEnabled: z.boolean().default(false),
  payrollEnabled: z.boolean().default(false),
  contingencyEnabled: z.boolean().default(true),
  habilitacionChecklist: z.record(z.string(), z.any()).optional().nullable()
});

const numberingSchema = z.object({
  documentType: z.enum(['FACTURA_ELECTRONICA','DOCUMENTO_EQUIVALENTE_POS','DOCUMENTO_SOPORTE','NOMINA_ELECTRONICA','NOTA_AJUSTE']),
  prefix: z.string().trim().max(10).default(''),
  rangeFrom: z.coerce.number().int().min(1),
  rangeTo: z.coerce.number().int().min(1),
  nextNumber: z.coerce.number().int().min(1).optional(),
  authorizationNumber: z.string().trim().max(100).optional().nullable(),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  active: z.boolean().default(true)
});

router.get('/configuracion', requirePermission('DIAN.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getPublicConfig(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/configuracion', requirePermission('DIAN.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveConfig(req.tenantId, req.userId, parse(configSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/readiness', requirePermission('DIAN.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.readiness(req.tenantId) }); }
  catch (error) { next(error); }
});

router.get('/numeracion', requirePermission('DIAN.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listNumberingRanges(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/numeracion', requirePermission('DIAN.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveNumberingRange(req.tenantId, parse(numberingSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/documentos', requirePermission('DIAN.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listDocuments(req.tenantId, req.query) }); }
  catch (error) { next(error); }
});

router.post('/documentos/:id/reintentar', requirePermission('DIAN.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.processDocument(req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/compras/:id/documento-soporte', requirePermission('DIAN.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.enqueueDocumentSupportForPurchase(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

module.exports = { dianRouter: router };
