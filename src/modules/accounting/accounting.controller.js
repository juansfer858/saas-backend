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
    const data = await service.listJournals(req.tenantId, {
      estado: req.query.estado,
      limit: req.query.limit
    });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = { createAccount, listAccounts, createJournal, listJournals };
