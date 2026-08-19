const service = require('./purchase.service');
const cancelService = require('./purchase-cancel.service');
const commercialService = require('./commercial.service');
const { commercialDocumentSchema } = require('./commercial.schemas');
const { purchaseDraftSchema, purchaseUpdateSchema, purchaseCancelSchema } = require('./purchase.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de compra inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function isLegacyCommercialPayload(body) {
  return Boolean(
    body && (
      Object.prototype.hasOwnProperty.call(body, 'terceroId') ||
      Object.prototype.hasOwnProperty.call(body, 'formaPago') ||
      Object.prototype.hasOwnProperty.call(body, 'estado') ||
      (Array.isArray(body.detalles) && body.detalles.some((line) => Object.prototype.hasOwnProperty.call(line || {}, 'precioUnitario')))
    )
  );
}

async function list(req, res, next) {
  try {
    const result = await service.list(req.tenantId, {
      proveedorId: req.query.proveedorId,
      estado: req.query.estado,
      desde: req.query.desde,
      hasta: req.query.hasta,
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit
    });
    res.json({ ok: true, data: result.items, meta: result.meta });
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try { res.json({ ok: true, data: await service.get(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function createDraft(req, res, next) {
  try {
    // Compatibilidad con integraciones/API anteriores: el endpoint histórico de
    // compras aceptaba el contrato comercial genérico e incluso emisión directa.
    // La nueva pantalla usa siempre el contrato especializado y crea BORRADOR.
    if (isLegacyCommercialPayload(req.body)) {
      const parsed = commercialDocumentSchema.safeParse({ ...req.body, tipo: 'COMPRA' });
      if (!parsed.success) throw new AppError(400, 'Datos del comprobante inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
      if (!parsed.data.terceroId) throw new AppError(400, 'La compra requiere seleccionar un proveedor', 'COMMERCIAL_THIRD_PARTY_REQUIRED');
      const data = await commercialService.createDocument(req.tenantId, req.userId, parsed.data);
      return res.status(201).json({ ok: true, data });
    }

    const data = await service.createDraft(req.tenantId, req.userId, parse(purchaseDraftSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function updateDraft(req, res, next) {
  try {
    const data = await service.updateDraft(req.tenantId, req.userId, req.params.id, parse(purchaseUpdateSchema, req.body));
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function emit(req, res, next) {
  try { res.json({ ok: true, data: await service.emit(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function cancel(req, res, next) {
  try {
    const input = parse(purchaseCancelSchema, req.body);
    const result = await cancelService.cancelPurchase(req.tenantId, req.userId, req.params.id, input.motivo);
    const documento = await service.get(req.tenantId, result.documentoId);
    res.json({ ok: true, data: { documento, notaId: result.notaId, yaAnulada: result.yaAnulada } });
  } catch (error) { next(error); }
}

module.exports = { list, get, createDraft, updateDraft, emit, cancel };
