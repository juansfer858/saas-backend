const service = require('./treasury.service');
const integrationService = require('./treasury-integration.service');
const bankMappingService = require('./treasury-bank-mapping.service');
const carteraReport = require('./cartera-report.service');
const {
  cajaBancoSchema,
  aperturaSchema,
  cierreSchema,
  paymentSchema,
  transferSchema,
  directExpenseSchema,
  batchPaymentSchema
} = require('./treasury.schemas');
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

async function setCajaBancoAccounting(req, res, next) {
  try {
    const cuentaContableId = String(req.body?.cuentaContableId || '').trim();
    if (!cuentaContableId) throw new AppError(400, 'Seleccione una cuenta PUC', 'TREASURY_ACCOUNTING_ACCOUNT_REQUIRED');
    res.json({ ok: true, data: await bankMappingService.setAccountingAccount(req.tenantId, req.userId, req.params.id, cuentaContableId) });
  } catch (error) { next(error); }
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

async function carteraAging(req, res, next) {
  try {
    res.json({ ok: true, data: await carteraReport.aging(req.tenantId, { tipo: req.query.tipo, terceroId: req.query.terceroId, corte: req.query.corte }) });
  } catch (error) { next(error); }
}

async function carteraThirdPartyDetail(req, res, next) {
  try {
    res.json({ ok: true, data: await carteraReport.thirdPartyDetail(req.tenantId, req.params.terceroId, { tipo: req.query.tipo }) });
  } catch (error) { next(error); }
}

async function carteraAccountingReconciliation(req, res, next) {
  try {
    res.json({ ok: true, data: await carteraReport.accountingReconciliation(req.tenantId, String(req.query.tipo || 'CXC').toUpperCase()) });
  } catch (error) { next(error); }
}

async function registerPayment(req, res, next) {
  try {
    const data = await service.registerPayment(req.tenantId, req.userId, parse(paymentSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function registerPaymentBatch(req, res, next) {
  try {
    const data = await integrationService.allocatePaymentBatch(req.tenantId, req.userId, parse(batchPaymentSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function transferOwnFunds(req, res, next) {
  try {
    const data = await integrationService.transferOwnFunds(req.tenantId, req.userId, parse(transferSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function directExpense(req, res, next) {
  try {
    const data = await integrationService.directExpense(req.tenantId, req.userId, parse(directExpenseSchema, req.body));
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
  setCajaBancoAccounting,
  deactivateCajaBanco,
  openCashSession,
  closeCashSession,
  listCartera,
  carteraAging,
  carteraThirdPartyDetail,
  carteraAccountingReconciliation,
  registerPayment,
  registerPaymentBatch,
  transferOwnFunds,
  directExpense,
  listPayments
};
