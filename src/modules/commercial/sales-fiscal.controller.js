const { z } = require('zod');
const fiscalSales = require('./sales-fiscal.service');
const { commercialDocumentSchema } = require('./commercial.schemas');
const { AppError } = require('../../utils/app-error');

const fiscalSaleSchema = commercialDocumentSchema.omit({ tipo: true }).extend({
  documentType: z.enum(['FACTURA_ELECTRONICA', 'DOCUMENTO_EQUIVALENTE_POS']).optional().default('DOCUMENTO_EQUIVALENTE_POS')
});
const emitSchema = z.object({ documentType: z.enum(['FACTURA_ELECTRONICA', 'DOCUMENTO_EQUIVALENTE_POS']).optional().default('DOCUMENTO_EQUIVALENTE_POS') });

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de venta inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function create(req, res, next) {
  try {
    const input = parse(fiscalSaleSchema, req.body);
    const data = await fiscalSales.createSale(req.tenantId, req.userId, input);
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function emit(req, res, next) {
  try {
    const input = parse(emitSchema, req.body || {});
    const data = await fiscalSales.emitExistingSale(req.tenantId, req.userId, req.params.id, input.documentType);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = { create, emit };
