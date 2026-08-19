const express = require('express');
const { z } = require('zod');
const service = require('./platform.service');
const { AppError } = require('../../../utils/app-error');

const publicRouter = express.Router();
const adminRouter = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de plataforma inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const activeSchema = z.object({ active: z.boolean(), reason: z.string().max(500).optional().nullable() });
const controlSchema = z.object({
  planCode: z.string().trim().min(1).max(40).optional(),
  currentVersion: z.string().trim().max(60).optional().nullable(),
  targetVersion: z.string().trim().max(60).optional().nullable(),
  rolloutChannel: z.enum(['ESTABLE','PILOTO','PAUSADO']).optional(),
  maxUsers: z.coerce.number().int().positive().optional().nullable(),
  maxDocumentsMonthly: z.coerce.number().int().positive().optional().nullable(),
  maxStorageMb: z.coerce.number().int().positive().optional().nullable(),
  softLimitPercent: z.coerce.number().int().min(1).max(100).optional()
}).refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un cambio' });

publicRouter.post('/login', async (req, res, next) => {
  try {
    const input = parse(loginSchema, req.body);
    res.json({ ok: true, data: await service.login(input.email, input.password) });
  } catch (error) { next(error); }
});

adminRouter.use(async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new AppError(401, 'Autenticación de plataforma requerida', 'PLATFORM_AUTH_REQUIRED');
    let payload;
    try { payload = service.verifyPlatformToken(token); }
    catch (_error) { throw new AppError(401, 'Sesión de plataforma no válida', 'PLATFORM_AUTH_INVALID'); }
    if (payload.scope !== 'PLATFORM_ADMIN' || !payload.superAdminId) throw new AppError(403, 'Token sin alcance de plataforma', 'PLATFORM_SCOPE_FORBIDDEN');
    const admin = await require('../../../config/prisma').prisma.platformSuperAdmin.findFirst({ where: { id: payload.superAdminId, active: true } });
    if (!admin) throw new AppError(401, 'Sesión de plataforma no válida', 'PLATFORM_AUTH_INVALID');
    req.platformAdmin = admin;
    next();
  } catch (error) { next(error); }
});

adminRouter.get('/tenants', async (_req, res, next) => {
  try { res.json({ ok: true, data: await service.listTenants() }); }
  catch (error) { next(error); }
});
adminRouter.put('/tenants/:tenantId/estado', async (req, res, next) => {
  try {
    const input = parse(activeSchema, req.body);
    res.json({ ok: true, data: await service.setTenantActive(req.platformAdmin.id, req.params.tenantId, input.active, input.reason) });
  } catch (error) { next(error); }
});
adminRouter.put('/tenants/:tenantId/control', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.setTenantControl(req.platformAdmin.id, req.params.tenantId, parse(controlSchema, req.body)) }); }
  catch (error) { next(error); }
});
adminRouter.put('/tenants/:tenantId/users/:userId/estado', async (req, res, next) => {
  try {
    const input = parse(activeSchema, req.body);
    res.json({ ok: true, data: await service.setUserActive(req.platformAdmin.id, req.params.tenantId, req.params.userId, input.active) });
  } catch (error) { next(error); }
});
adminRouter.get('/metricas', async (_req, res, next) => {
  try { res.json({ ok: true, data: await service.metrics() }); }
  catch (error) { next(error); }
});
adminRouter.get('/auditoria', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAudit(req.query.limit) }); }
  catch (error) { next(error); }
});

module.exports = { platformPublicRouter: publicRouter, platformAdminRouter: adminRouter };
