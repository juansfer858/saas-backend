const service = require('./treasury.service');
const { cajaBancoSchema, aperturaSchema, cierreSchema, paymentSchema } = require('./treasury.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de tesorería inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function createCajaBanco(req, res, next) {
  try {
    const data = await service.createCajaBanco(req.tenantId, parse(cajaBancoSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listCajaBanco(req, res, next) {
  try { res.json({ ok: true, data: await service.listCajaBanco(req.tenantId) }); }
  catch (error) { next(error); }
}

async function deactivateCajaBanco(req, res, next) {
  try { res.json({ ok: true, data: await service.deactivateCajaBanco(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function openCashSession(req, res, next) {
  try {
    const data = await service.openCashSession(req.tenantId, req.userId, req.params.cajaBancoId, parse(aperturaSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function closeCashSession(req, res, next) {
  try {
    const data = await service.closeCashSession(req.tenantId, req.userId, req.params.sessionId, parse(cierreSchema, req.body));
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listCartera(req, res, next) {
  try {
    const result = await service.listCartera(req.tenantId, {
      tipo: req.query.tipo,
      estado: req.query.estado,
      terceroId: req.query.terceroId,
      desde: req.query.desde,
      hasta: req.query.hasta,
      montoMin: req.query.montoMin,
      montoMax: req.query.montoMax,
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit
    });
    res.json({ ok: true, data: result.items, meta: result.meta });
  } catch (error) { next(error); }
}

async function registerPayment(req, res, next) {
  try {
    const data = await service.registerPayment(req.tenantId, req.userId, parse(paymentSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listPayments(req, res, next) {
  try {
    const data = await service.listPayments(req.tenantId, {
      documentoId: req.query.documentoId,
      cajaBancoId: req.query.cajaBancoId,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = {
  createCajaBanco,
  listCajaBanco,
  deactivateCajaBanco,
  openCashSession,
  closeCashSession,
  listCartera,
  registerPayment,
  listPayments
};
