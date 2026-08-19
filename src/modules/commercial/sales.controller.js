const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const service = require('./sales.service');
const { detailSchema } = require('./commercial.schemas');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de venta inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const documentTypeSchema = z.enum(['FACTURA_ELECTRONICA', 'DOCUMENTO_EQUIVALENTE_POS']);
const saleSchema = z.object({
  estado: z.enum(['BORRADOR', 'EMITIDO']).default('BORRADOR'),
  sourceId: z.string().trim().max(120).optional().nullable(),
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  documentType: documentTypeSchema.default('DOCUMENTO_EQUIVALENTE_POS'),
  notas: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1)
});

const updateSchema = z.object({
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']).optional().nullable(),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  documentType: documentTypeSchema.optional(),
  notas: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'Debe enviar al menos un cambio' });

const cancelSchema = z.object({ motivo: z.string().trim().min(3).max(500) });

async function list(req, res, next) {
  try {
    res.json({ ok: true, data: await service.list(req.tenantId, req.query) });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.create(req.tenantId, req.userId, parse(saleSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function get(req, res, next) {
  try { res.json({ ok: true, data: await service.get(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function update(req, res, next) {
  try { res.json({ ok: true, data: await service.updateDraft(req.tenantId, req.userId, req.params.id, parse(updateSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function emit(req, res, next) {
  try { res.json({ ok: true, data: await service.emit(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function cancel(req, res, next) {
  try { res.json({ ok: true, data: await service.cancel(req.tenantId, req.userId, req.params.id, parse(cancelSchema, req.body).motivo) }); }
  catch (error) { next(error); }
}

module.exports = { list, create, get, update, emit, cancel };
