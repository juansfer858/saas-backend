const service = require('./core-integration.service');
const schemas = require('./core-integration.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de integración inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function requireAdmin(req) {
  if (req.userRole !== 'ADMIN') throw new AppError(403, 'Solo ADMIN puede cambiar la parametrización contable', 'ADMIN_REQUIRED');
}

async function getParametrization(req, res, next) {
  try { res.json({ ok: true, data: await service.getParametrization(req.tenantId) }); }
  catch (error) { next(error); }
}

async function updateParametrization(req, res, next) {
  try {
    requireAdmin(req);
    res.json({ ok: true, data: await service.updateParametrization(req.tenantId, parse(schemas.parametrizationSchema, req.body)) });
  } catch (error) { next(error); }
}

async function createInventoryAdjustment(req, res, next) {
  try {
    res.status(201).json({ ok: true, data: await service.createInventoryAdjustment(req.tenantId, req.userId, parse(schemas.inventoryAdjustmentSchema, req.body)) });
  } catch (error) { next(error); }
}

async function transferOwnFunds(req, res, next) {
  try {
    res.status(201).json({ ok: true, data: await service.transferOwnFunds(req.tenantId, req.userId, parse(schemas.transferSchema, req.body)) });
  } catch (error) { next(error); }
}

async function directExpense(req, res, next) {
  try {
    res.status(201).json({ ok: true, data: await service.directExpense(req.tenantId, req.userId, parse(schemas.directExpenseSchema, req.body)) });
  } catch (error) { next(error); }
}

async function applyMultiplePayments(req, res, next) {
  try {
    res.status(201).json({ ok: true, data: await service.applyMultiplePayments(req.tenantId, req.userId, parse(schemas.multiplePaymentSchema, req.body)) });
  } catch (error) { next(error); }
}

async function carteraSummary(req, res, next) {
  try { res.json({ ok: true, data: await service.getCarteraSummary(req.tenantId, req.query) }); }
  catch (error) { next(error); }
}

async function thirdPartyAccountingDetail(req, res, next) {
  try { res.json({ ok: true, data: await service.getThirdPartyAccountingDetail(req.tenantId, req.params.id, req.query.tipo || 'CXC') }); }
  catch (error) { next(error); }
}

async function getThirdPartyExtended(req, res, next) {
  try { res.json({ ok: true, data: await service.getThirdPartyExtended(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function updateThirdPartyExtended(req, res, next) {
  try {
    res.json({ ok: true, data: await service.updateThirdPartyExtended(req.tenantId, req.params.id, parse(schemas.thirdPartyOperationSchema, req.body)) });
  } catch (error) { next(error); }
}

module.exports = {
  getParametrization,
  updateParametrization,
  createInventoryAdjustment,
  transferOwnFunds,
  directExpense,
  applyMultiplePayments,
  carteraSummary,
  thirdPartyAccountingDetail,
  getThirdPartyExtended,
  updateThirdPartyExtended
};
