const service = require('./third-party.service');
const { thirdPartySchema, updateThirdPartySchema } = require('./third-party.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'Datos de tercero inválidos', 'VALIDATION_ERROR', result.error.flatten());
  }
  return result.data;
}

async function create(req, res, next) {
  try {
    const data = await service.create(req.tenantId, parse(thirdPartySchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const data = await service.list(req.tenantId, {
      tipo: req.query.tipo,
      q: req.query.q,
      limit: req.query.limit,
      activo: req.query.activo === undefined ? undefined : req.query.activo === 'true'
    });
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    const data = await service.getById(req.tenantId, req.params.id);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await service.update(req.tenantId, req.params.id, parse(updateThirdPartySchema, req.body));
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, getById, update };
