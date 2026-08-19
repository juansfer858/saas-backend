const service = require('./commercial.service');
const { commercialDocumentSchema } = require('./commercial.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos del comprobante inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function createDocument(req, res, next) {
  try {
    const data = await service.createDocument(req.tenantId, req.userId, parse(commercialDocumentSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listDocuments(req, res, next) {
  try {
    const data = await service.listDocuments(req.tenantId, {
      tipo: req.query.tipo,
      estado: req.query.estado,
      terceroId: req.query.terceroId,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getDocument(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getDocument(req.tenantId, req.params.id) });
  } catch (error) { next(error); }
}

module.exports = { createDocument, listDocuments, getDocument };
