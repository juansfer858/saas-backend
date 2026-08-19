const integration = require('./accounting-integration.service');
const { AppError } = require('../../utils/app-error');

async function listMappings(req, res, next) {
  try {
    res.json({ ok: true, data: await integration.listMappings(req.tenantId) });
  } catch (error) { next(error); }
}

async function updateMapping(req, res, next) {
  try {
    const cuentaId = String(req.body?.cuentaId || '').trim();
    if (!cuentaId) throw new AppError(400, 'Seleccione una cuenta contable', 'ACCOUNTING_MAPPING_ACCOUNT_REQUIRED');
    const data = await integration.setMapping(req.tenantId, req.userId, req.params.clave, cuentaId);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

async function getIntegrationStatus(req, res, next) {
  try {
    res.json({ ok: true, data: await integration.integrationStatus(req.tenantId) });
  } catch (error) { next(error); }
}

module.exports = { listMappings, updateMapping, getIntegrationStatus };
