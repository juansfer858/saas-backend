const service = require('./accounting.service');
const numbering = require('./accounting-numbering.service');
const governance = require('./accounting-governance.service');
const taxes = require('./accounting-tax.service');
const fixedAssets = require('./fixed-assets.service');
const reconciliation = require('./bank-reconciliation.service');
const supports = require('./accounting-supports.service');
const exporter = require('./accounting-export.service');
const schemas = require('./accounting.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos contables inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

function compareFlag(req) {
  return req.query.comparar === 'true' || req.query.comparar === '1';
}

async function createAccount(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createAccount(req.tenantId, parse(schemas.accountSchema, req.body), req.userId) }); }
  catch (error) { next(error); }
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
  try { res.status(201).json({ ok: true, data: await service.createManualJournal(req.tenantId, req.userId, parse(schemas.journalSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function createDraftJournal(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createDraftManualJournal(req.tenantId, req.userId, parse(schemas.journalSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function postDraftJournal(req, res, next) {
  try { res.json({ ok: true, data: await service.postDraftJournal(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function reverseJournal(req, res, next) {
  try {
    const body = parse(schemas.reverseSchema, req.body);
    res.status(201).json({ ok: true, data: await service.reverseJournal(req.tenantId, req.userId, req.params.id, body.motivo) });
  } catch (error) { next(error); }
}

async function listJournals(req, res, next) {
  try {
    const result = await service.listJournals(req.tenantId, {
      estado: req.query.estado,
      origen: req.query.origen,
      tipoComprobanteId: req.query.tipoComprobanteId,
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
  try { res.json({ ok: true, data: await service.getJournal(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function getLedger(req, res, next) {
  try {
    const data = await service.getLedger(req.tenantId, { cuentaId: req.query.cuentaId, desde: req.query.desde, hasta: req.query.hasta, limit: req.query.limit });
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getTrialBalance(req, res, next) {
  try { res.json({ ok: true, data: await service.getTrialBalance(req.tenantId, { desde: req.query.desde, hasta: req.query.hasta, comparar: compareFlag(req) }) }); }
  catch (error) { next(error); }
}

async function getProfitAndLoss(req, res, next) {
  try { res.json({ ok: true, data: await service.getProfitAndLoss(req.tenantId, { desde: req.query.desde, hasta: req.query.hasta, comparar: compareFlag(req) }) }); }
  catch (error) { next(error); }
}

async function getBalanceSheet(req, res, next) {
  try { res.json({ ok: true, data: await service.getBalanceSheet(req.tenantId, { corte: req.query.corte, comparar: compareFlag(req) }) }); }
  catch (error) { next(error); }
}

async function listVoucherTypes(req, res, next) {
  try { res.json({ ok: true, data: await numbering.listVoucherTypes(require('../../config/prisma').prisma, req.tenantId) }); }
  catch (error) { next(error); }
}

async function createVoucherType(req, res, next) {
  try { res.status(201).json({ ok: true, data: await numbering.createVoucherType(require('../../config/prisma').prisma, req.tenantId, parse(schemas.voucherTypeSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function updateVoucherType(req, res, next) {
  try { res.json({ ok: true, data: await numbering.updateVoucherType(require('../../config/prisma').prisma, req.tenantId, req.params.id, parse(schemas.updateVoucherTypeSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listPeriods(req, res, next) {
  try { res.json({ ok: true, data: await governance.listPeriods(req.tenantId, req.query.limit) }); }
  catch (error) { next(error); }
}

async function closePeriod(req, res, next) {
  try { res.status(201).json({ ok: true, data: await governance.closePeriod(req.tenantId, req.userId, Number(req.params.anio), Number(req.params.mes)) }); }
  catch (error) { next(error); }
}

async function reopenPeriod(req, res, next) {
  try { res.status(201).json({ ok: true, data: await governance.reopenPeriod(req.tenantId, req.userId, req.userRole, Number(req.params.anio), Number(req.params.mes)) }); }
  catch (error) { next(error); }
}

async function getConfig(req, res, next) {
  try { res.json({ ok: true, data: await governance.getConfig(req.tenantId) }); }
  catch (error) { next(error); }
}

async function updateConfig(req, res, next) {
  try { res.json({ ok: true, data: await governance.updateConfig(req.tenantId, req.userId, parse(schemas.configSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listVatRates(req, res, next) {
  try { res.json({ ok: true, data: await taxes.listVatRates(req.tenantId) }); }
  catch (error) { next(error); }
}

async function createVatRate(req, res, next) {
  try { res.status(201).json({ ok: true, data: await taxes.upsertVatRate(req.tenantId, req.userId, parse(schemas.vatSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function updateVatRate(req, res, next) {
  try { res.json({ ok: true, data: await taxes.upsertVatRate(req.tenantId, req.userId, parse(schemas.vatSchema, req.body), req.params.id) }); }
  catch (error) { next(error); }
}

async function listRetentions(req, res, next) {
  try { res.json({ ok: true, data: await taxes.listRetentions(req.tenantId) }); }
  catch (error) { next(error); }
}

async function createRetention(req, res, next) {
  try { res.status(201).json({ ok: true, data: await taxes.upsertRetention(req.tenantId, req.userId, parse(schemas.retentionSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function updateRetention(req, res, next) {
  try { res.json({ ok: true, data: await taxes.upsertRetention(req.tenantId, req.userId, parse(schemas.retentionSchema, req.body), req.params.id) }); }
  catch (error) { next(error); }
}

async function calculateTaxes(req, res, next) {
  try { res.json({ ok: true, data: await taxes.calculateTaxes(req.tenantId, parse(schemas.taxCalculationSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listAssets(req, res, next) {
  try { res.json({ ok: true, data: await fixedAssets.listAssets(req.tenantId) }); }
  catch (error) { next(error); }
}

async function createAsset(req, res, next) {
  try { res.status(201).json({ ok: true, data: await fixedAssets.createAsset(req.tenantId, req.userId, parse(schemas.assetSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function generateDepreciation(req, res, next) {
  try {
    const body = parse(schemas.depreciationSchema, req.body);
    res.status(201).json({ ok: true, data: await fixedAssets.generateDepreciation(req.tenantId, req.userId, req.params.id, body.anio, body.mes) });
  } catch (error) { next(error); }
}

async function listReconciliations(req, res, next) {
  try { res.json({ ok: true, data: await reconciliation.listReconciliations(req.tenantId, { cajaBancoId: req.query.cajaBancoId, estado: req.query.estado }) }); }
  catch (error) { next(error); }
}

async function createReconciliation(req, res, next) {
  try { res.status(201).json({ ok: true, data: await reconciliation.createReconciliation(req.tenantId, req.userId, parse(schemas.reconciliationSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function listReconciliationMovements(req, res, next) {
  try { res.json({ ok: true, data: await reconciliation.candidateMovements(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
}

async function matchReconciliationEntry(req, res, next) {
  try {
    const body = parse(schemas.matchEntrySchema, req.body);
    res.json({ ok: true, data: await reconciliation.matchEntry(req.tenantId, req.userId, req.params.id, req.params.partidaId, body.movimientoTesoreriaId || null) });
  } catch (error) { next(error); }
}

async function closeReconciliation(req, res, next) {
  try { res.json({ ok: true, data: await reconciliation.closeReconciliation(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
}

async function addSupport(req, res, next) {
  try { res.status(201).json({ ok: true, data: await supports.addSupport(req.tenantId, req.userId, req.params.id, parse(schemas.supportSchema, req.body)) }); }
  catch (error) { next(error); }
}

async function downloadSupport(req, res, next) {
  try {
    const support = await supports.getSupport(req.tenantId, req.params.soporteId);
    res.setHeader('Content-Type', support.mimeType);
    res.setHeader('Content-Length', String(support.tamano));
    res.setHeader('Content-Disposition', `inline; filename="${String(support.nombre).replace(/["\r\n]/g, '_')}"`);
    res.send(Buffer.from(support.contenido));
  } catch (error) { next(error); }
}

async function exportReport(req, res, next) {
  try {
    const result = await exporter.exportReport(req.tenantId, req.params.tipo, req.query.formato, {
      desde: req.query.desde,
      hasta: req.query.hasta,
      corte: req.query.corte,
      cuentaId: req.query.cuentaId,
      q: req.query.q
    });
    const safe = result.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.${result.extension}"`);
    res.send(result.buffer);
  } catch (error) { next(error); }
}

module.exports = {
  createAccount, listAccounts,
  createJournal, createDraftJournal, postDraftJournal, reverseJournal, listJournals, getJournal,
  getLedger, getTrialBalance, getProfitAndLoss, getBalanceSheet,
  listVoucherTypes, createVoucherType, updateVoucherType,
  listPeriods, closePeriod, reopenPeriod, getConfig, updateConfig,
  listVatRates, createVatRate, updateVatRate, listRetentions, createRetention, updateRetention, calculateTaxes,
  listAssets, createAsset, generateDepreciation,
  listReconciliations, createReconciliation, listReconciliationMovements, matchReconciliationEntry, closeReconciliation,
  addSupport, downloadSupport, exportReport
};
