const service = require('./user.service');
const { userSchema, updateUserSchema } = require('./user.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de usuario inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

async function createUser(req, res, next) {
  try {
    const data = await service.createUser(req.tenantId, parse(userSchema, req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
}

async function listUsers(req, res, next) {
  try { res.json({ ok: true, data: await service.listUsers(req.tenantId) }); }
  catch (error) { next(error); }
}

async function updateUser(req, res, next) {
  try {
    const data = await service.updateUser(req.tenantId, req.params.id, parse(updateUserSchema, req.body));
    res.json({ ok: true, data });
  } catch (error) { next(error); }
}

module.exports = { createUser, listUsers, updateUser };
