const service = require('./commercial.service');
const integration = require('../integration/core-integration.service');
const {
  commercialDocumentSchema,
  updateDraftSchema,
  cancelDocumentSchema,
  replaceDocumentSchema
} = require('./commercial.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos del comprobante inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function filtersFromQuery(query, forcedType) {
  return {
    tipo: forcedType || query.tipo,
    estado: query.estado,
    terceroId: query.terceroId,
    desde: query.desde,
    hasta: query.hasta,
    montoMin: query.montoMin,
    montoMax: query.montoMax,
    page: query.page,
    pageSize: query.pageSize || query.limit
  };
}

function responsePage(res, result) {
  return res.json({ ok: true, data: result.items, meta: result.meta });
}

async function preflightIfTransactional(tenantId, input) {
  if (!['FACTURA_VENTA', 'COMPRA'].includes(input.tipo)) return;
  if ((input.estado || 'EMITIDO') === 'BORRADOR') return;
  await integration.preflightCommercialInput(tenantId, input.tipo, input);
}

async function createDocument(req, res, next) {
  try {
    const input = parse(commercialDocumentSchema, req.body);
    await preflightIfTransactional(req.tenantId, input);
    const data = await service.createDocument(req.tenantId, req.userId, input);
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listDocuments(req, res, next) {
  try { responsePage(res, await service.listDocuments(req.tenantId, filtersFromQuery(req.query))); }
  catch (error) { next(error); }
}

async function getDocument(req, res, next) {
  try { res.json({ ok: true, data: await service.getDocument(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function updateDocument(req, res, next) {
  try {
    const data = await service.updateDraftDocument(req.tenantId, req.userId, req.params.id, parse(updateDraftSchema, req.body));
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function emitDocument(req, res, next) {
  try {
    await integration.preflightExistingDocument(req.tenantId, req.params.id);
    const data = await service.emitDocument(req.tenantId, req.userId, req.params.id);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function cancelDocument(req, res, next) {
  try {
    const input = parse(cancelDocumentSchema, req.body);
    const data = await service.cancelDocument(req.tenantId, req.userId, req.params.id, input.motivo);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function replaceDocument(req, res, next) {
  try {
    const data = await service.replaceIssuedDocument(req.tenantId, req.userId, req.params.id, parse(replaceDocumentSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

function createTyped(type) {
  return async (req, res, next) => {
    try {
      const input = parse(commercialDocumentSchema, { ...req.body, tipo: type });
      await preflightIfTransactional(req.tenantId, input);
      const data = await service.createDocument(req.tenantId, req.userId, input);
      res.status(201).json({ ok: true, data });
    } catch (error) { next(error); }
  };
}

function listTyped(type) {
  return async (req, res, next) => {
    try { responsePage(res, await service.listDocuments(req.tenantId, filtersFromQuery(req.query, type))); }
    catch (error) { next(error); }
  };
}

async function getTyped(req, res, next, type) {
  try {
    const data = await service.getDocument(req.tenantId, req.params.id);
    if (data.tipo !== type) throw new AppError(404, 'Documento no encontrado', 'COMMERCIAL_DOCUMENT_NOT_FOUND');
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

const createSale = createTyped('FACTURA_VENTA');
const listSales = listTyped('FACTURA_VENTA');
const getSale = (req, res, next) => getTyped(req, res, next, 'FACTURA_VENTA');
const createPurchase = createTyped('COMPRA');
const listPurchases = listTyped('COMPRA');
const getPurchase = (req, res, next) => getTyped(req, res, next, 'COMPRA');

module.exports = {
  createDocument,
  listDocuments,
  getDocument,
  updateDocument,
  emitDocument,
  cancelDocument,
  replaceDocument,
  createSale,
  listSales,
  getSale,
  createPurchase,
  listPurchases,
  getPurchase
};
