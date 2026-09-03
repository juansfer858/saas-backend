'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./restaurant-menu-import.service');
const localOcr = require('./restaurant-menu-local-ocr.service');
const cleanup = require('./restaurant-menu-ocr-cleanup.service');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();
const rawMenuFileParser = express.raw({ type: 'application/octet-stream', limit: service.MAX_FILE_BYTES });

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de importación de carta inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function parseRawMenuFile(req, res, next) {
  rawMenuFileParser(req, res, (error) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      return next(new AppError(
        413,
        `La carta supera el máximo de ${Math.floor(service.MAX_FILE_BYTES / 1024 / 1024)} MB`,
        'RESTAURANT_MENU_OCR_FILE_TOO_LARGE'
      ));
    }
    if (error) return next(error);
    return next();
  });
}

function resolvedOcrStatus() {
  const local = localOcr.providerStatus(service.MAX_FILE_BYTES);
  if (local.configured) return local;
  return service.providerStatus();
}

async function analyzeWithAvailableProvider(input) {
  const local = localOcr.providerStatus(service.MAX_FILE_BYTES);
  if (local.configured) return localOcr.analyzeDocument(input, service.MAX_FILE_BYTES);
  return service.analyzeDocument(input);
}

const analyzeSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(16)
});

const binaryAnalyzeMetaSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
});

const itemSchema = z.object({
  category: z.string().trim().min(1).max(80),
  subcategory: z.string().trim().min(1).max(180),
  price: z.coerce.number().positive().max(1000000000),
  operationalCategory: z.enum(['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES']),
  station: z.enum(['COCINA', 'BARRA', 'POSTRES']),
  confidence: z.coerce.number().min(0).max(1).optional().default(1)
});

const confirmSchema = z.object({
  fileName: z.string().trim().max(120).optional().nullable(),
  items: z.array(itemSchema).min(1).max(300)
});

router.get('/carta-importacion/status', requirePermission('RESTAURANTE.ADMINISTRAR'), async (_req, res, next) => {
  try {
    const status = resolvedOcrStatus();
    res.json({
      ok: true,
      data: {
        ...status,
        acceptedMimeTypes: [...service.ALLOWED_MIME_TYPES],
        note: status.configured
          ? status.provider === 'LOCAL_OCR' ? 'OCR local listo para analizar foto o PDF sin API key' : 'OCR listo para analizar foto o PDF'
          : 'OCR no disponible en este servidor'
      }
    });
  } catch (error) { next(error); }
});

router.get('/carta-importacion/lista', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listCarta(req.tenantId) }); } catch (error) { next(error); }
});

// Legacy JSON/base64 entrypoint remains available for compatibility. New browser uploads use
// the scoped binary route below so a 10 MiB menu does not expand to ~13.3 MiB before parsing.
router.post('/carta-importacion/analizar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(analyzeSchema, req.body || {});
    res.json({ ok: true, data: await analyzeWithAvailableProvider(input) });
  } catch (error) { next(error); }
});

router.post(
  '/carta-importacion/analizar-binario',
  requirePermission('RESTAURANTE.ADMINISTRAR'),
  parseRawMenuFile,
  async (req, res, next) => {
    try {
      const meta = parse(binaryAnalyzeMetaSchema, req.query || {});
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) throw new AppError(400, 'El archivo está vacío', 'RESTAURANT_MENU_OCR_FILE_EMPTY');
      const input = { ...meta, dataBase64: buffer.toString('base64') };
      res.json({ ok: true, data: await analyzeWithAvailableProvider(input) });
    } catch (error) { next(error); }
  }
);

router.post('/carta-importacion/confirmar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(confirmSchema, req.body || {});
    res.status(201).json({ ok: true, data: await service.confirmImport(req.tenantId, req.userId, input) });
  } catch (error) { next(error); }
});

router.delete('/carta-importacion/importados-ocr', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await cleanup.clearImportedOcr(req.tenantId) });
  } catch (error) { next(error); }
});

module.exports = {
  restaurantMenuImportRouter: router,
  resolvedOcrStatus,
  analyzeWithAvailableProvider,
  parseRawMenuFile
};
