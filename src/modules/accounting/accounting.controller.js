const service = require('./accounting.service');
const { accountSchema, journalSchema } = require('./accounting.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos contables inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function createAccount(req, res, next) {
  try {
    const data = await service.createAccount(req.tenantId, parse(accountSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listAccounts(req, res, next) {
  try {
    const data = await service.listAccounts(req.tenantId, {
      activa: req.query.activa === undefined ? undefined : req.query.activa === 'true',
      nivel: req.query.nivel,
      movimiento: req.query.movimiento === undefined ? undefined : req.query.movimiento === 'true',
      q: req.query.q,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function createJournal(req, res, next) {
  try {
    const data = await service.createManualJournal(req.tenantId, req.userId, parse(journalSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listJournals(req, res, next) {
  try {
    const result = await service.listJournals(req.tenantId, {
      estado: req.query.estado,
      origen: req.query.origen,
      desde: req.query.desde,
      hasta: req.query.hasta,
      q: req.query.q,
      page: req.query.page,
      pageSize: req.query.pageSize,
      limit: req.query.limit
    });
    res.json({ ok: true, data: result.items, meta: result.meta });
  } catch (error) { next(error); }
}

async function getJournal(req, res, next) {
  try {
    res.json({ ok: true, data: await service.getJournal(req.tenantId, req.params.id) });
  } catch (error) { next(error); }
}

async function getLedger(req, res, next) {
  try {
    const data = await service.getLedger(req.tenantId, {
      cuentaId: req.query.cuentaId,
      desde: req.query.desde,
      hasta: req.query.hasta,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getTrialBalance(req, res, next) {
  try {
    const data = await service.getTrialBalance(req.tenantId, {
      desde: req.query.desde,
      hasta: req.query.hasta
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getProfitAndLoss(req, res, next) {
  try {
    const data = await service.getProfitAndLoss(req.tenantId, {
      desde: req.query.desde,
      hasta: req.query.hasta
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = {
  createAccount,
  listAccounts,
  createJournal,
  listJournals,
  getJournal,
  getLedger,
  getTrialBalance,
  getProfitAndLoss
};
