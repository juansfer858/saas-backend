const authService = require('./auth.service');
const { registerTenantSchema, loginSchema } = require('./auth.schemas');
const { AppError } = require('../../utils/app-error');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'Datos de entrada inválidos', 'VALIDATION_ERROR', result.error.flatten());
  }
  return result.data;
}

async function registerTenant(req, res, next) {
  try {
    const input = parse(registerTenantSchema, req.body);
    const data = await authService.registerTenant(input);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const input = parse(loginSchema, req.body);
    const data = await authService.login(req.tenantId, input);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
}

async function session(req, res) {
  res.json({
    ok: true,
    data: {
      tenant: req.tenant,
      user: req.user
    }
  });
}

module.exports = {
  registerTenant,
  login,
  session
};
