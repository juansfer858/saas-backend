const express = require('express');
const { z } = require('zod');
const service = require('./printing.service');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de impresión inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const format = z.enum(['TERMICA_58','TERMICA_80','CARTA','MEDIA_CARTA','PDF_CARTA','PDF_MEDIA_CARTA']);
const configSchema = z.object({
  defaultFormat: format.optional(),
  invoicePdfFormat: format.optional(),
  logoUrl: z.string().url().optional().nullable(),
  headerText: z.string().max(500).optional().nullable(),
  footerText: z.string().max(500).optional().nullable(),
  qrMinimumMm: z.coerce.number().int().min(20).max(100).optional(),
  showLegalLegend: z.boolean().optional()
}).refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un cambio' });

const printerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(100),
  transport: z.enum(['NAVEGADOR','LAN']),
  role: z.string().trim().min(2).max(60).default('DOCUMENTOS'),
  host: z.string().trim().max(200).optional().nullable(),
  port: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  format: format.optional().nullable(),
  active: z.boolean().default(true)
});

router.get('/formatos', requirePermission('CONFIGURACION.VER'), (req, res) => {
  res.json({ ok: true, data: service.FORMAT_SPECS });
});
router.get('/configuracion', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getConfig(req.tenantId) }); }
  catch (error) { next(error); }
});
router.put('/configuracion', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveConfig(req.tenantId, req.userId, parse(configSchema, req.body)) }); }
  catch (error) { next(error); }
});
router.get('/impresoras', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listPrinters(req.tenantId) }); }
  catch (error) { next(error); }
});
router.post('/impresoras', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.savePrinter(req.tenantId, parse(printerSchema, req.body)) }); }
  catch (error) { next(error); }
});
router.get('/plantilla/:format', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try {
    const config = await service.getConfig(req.tenantId);
    res.json({ ok: true, data: service.templateContract(req.params.format, config.qrMinimumMm) });
  } catch (error) { next(error); }
});

module.exports = { printingRouter: router };
