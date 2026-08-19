const service = require('./purchase.service');
const { purchaseDraftSchema, purchaseUpdateSchema, purchaseCancelSchema } = require('./purchase.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de compra inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
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
    res.json({ ok: true, data: await service.cancel(req.tenantId, req.userId, req.params.id, input.motivo) });
  } catch (error) { next(error); }
}

module.exports = { list, get, createDraft, updateDraft, emit, cancel };
