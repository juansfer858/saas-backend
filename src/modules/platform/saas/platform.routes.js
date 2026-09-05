const express = require('express');
const { z } = require('zod');
const service = require('./platform.service');
const provisioning = require('./platform-tenant-provisioning.service');
const edgeRollout = require('./platform-edge-rollout.service');
const verticalRegistry = require('../verticals/vertical-registry');
const verticalEntitlements = require('../verticals/vertical-entitlement.service');
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
const verticalControlSchema = z.object({ active: z.boolean(), metadata: z.record(z.string(), z.any()).optional().nullable() });
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
const tenantCreateSchema = z.object({
  nombreEmpresa: z.string().trim().min(2).max(120),
  templateCode: z.enum(['CORE','RESTAURANTE']),
  nit: z.string().trim().min(3).max(40).optional().nullable(),
  pais: z.string().trim().length(2).toUpperCase().default('CO'),
  moneda: z.string().trim().length(3).toUpperCase().default('COP'),
  admin: z.object({
    nombre: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128)
  })
});
const restaurantFiscalDecisionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().trim().min(20).max(1200),
  acknowledgedNoDianValidity: z.boolean().optional().default(false)
});
const edgeReleaseSchema = z.object({
  version: z.string().trim().min(1).max(80),
  channel: z.enum(['PILOT','STABLE']),
  artifactUrl: z.string().url().max(2000),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  releaseNotes: z.string().max(5000).optional().nullable(),
  minCoreVersion: z.string().trim().max(80).optional().nullable(),
  mandatory: z.boolean().optional(),
  enabled: z.boolean().optional(),
  autoRollout: z.boolean().optional().default(true)
});
const edgeRolloutSchema = z.object({ scope: z.enum(['CHANNEL','ALL']).optional().default('CHANNEL') });
const edgeChannelSchema = z.object({ channel: z.enum(['PILOT','STABLE']) });
const edgeDeploySchema = z.object({ releaseId: z.string().uuid() });
const edgeCancelSchema = z.object({ reason: z.string().trim().max(1000).optional().nullable() });

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

adminRouter.get('/tenant-templates', async (_req, res, next) => {
  try { res.json({ ok: true, data: provisioning.templates() }); }
  catch (error) { next(error); }
});
adminRouter.get('/verticals', async (_req, res, next) => {
  try { res.json({ ok: true, data: verticalRegistry.listVerticals() }); }
  catch (error) { next(error); }
});
adminRouter.post('/tenants', async (req, res, next) => {
  try {
    const input = parse(tenantCreateSchema, req.body);
    res.status(201).json({ ok: true, data: await provisioning.createTenant(req.platformAdmin.id, input) });
  } catch (error) { next(error); }
});
adminRouter.get('/tenants', async (_req, res, next) => {
  try { res.json({ ok: true, data: await service.listTenants() }); }
  catch (error) { next(error); }
});
adminRouter.get('/edge/overview', async (req, res, next) => {
  try { res.json({ ok: true, data: await edgeRollout.listOverview() }); }
  catch (error) { next(error); }
});
adminRouter.post('/edge/releases', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await edgeRollout.createGlobalRelease(req.platformAdmin.id, parse(edgeReleaseSchema, req.body || {})) }); }
  catch (error) { next(error); }
});
adminRouter.post('/edge/releases/:id/rollout', async (req, res, next) => {
  try { res.json({ ok: true, data: await edgeRollout.rolloutRelease(req.platformAdmin.id, req.params.id, parse(edgeRolloutSchema, req.body || {})) }); }
  catch (error) { next(error); }
});
adminRouter.patch('/edge/installations/:edgeAgentId/channel', async (req, res, next) => {
  try { res.json({ ok: true, data: await edgeRollout.setInstallationChannel(req.platformAdmin.id, req.params.edgeAgentId, parse(edgeChannelSchema, req.body || {}).channel) }); }
  catch (error) { next(error); }
});
adminRouter.post('/edge/installations/:edgeAgentId/deploy', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await edgeRollout.deployOne(req.platformAdmin.id, req.params.edgeAgentId, parse(edgeDeploySchema, req.body || {}).releaseId) }); }
  catch (error) { next(error); }
});
adminRouter.post('/edge/installations/:edgeAgentId/cancel-deployment', async (req, res, next) => {
  try {
    const input = parse(edgeCancelSchema, req.body || {});
    res.json({ ok: true, data: await edgeRollout.cancelActiveDeployment(req.platformAdmin.id, req.params.edgeAgentId, input.reason || null) });
  } catch (error) { next(error); }
});
adminRouter.get('/tenants/:tenantId/verticals', async (req, res, next) => {
  try { res.json({ ok: true, data: await verticalEntitlements.listTenantEntitlements(req.params.tenantId) }); }
  catch (error) { next(error); }
});
adminRouter.put('/tenants/:tenantId/verticals/:verticalCode', async (req, res, next) => {
  try {
    const input = parse(verticalControlSchema, req.body || {});
    res.json({ ok: true, data: await verticalEntitlements.setFromPlatform(req.platformAdmin.id, req.params.tenantId, req.params.verticalCode, input.active, input.metadata || null) });
  } catch (error) { next(error); }
});
adminRouter.get('/tenants/:tenantId/users', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listTenantUsers(req.params.tenantId) }); }
  catch (error) { next(error); }
});
adminRouter.get('/tenants/:tenantId/restaurante/fiscal-simulado', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getRestaurantFiscalGovernance(req.params.tenantId) }); }
  catch (error) { next(error); }
});
adminRouter.put('/tenants/:tenantId/restaurante/fiscal-simulado', async (req, res, next) => {
  try {
    const input = parse(restaurantFiscalDecisionSchema, req.body);
    res.json({ ok: true, data: await service.setRestaurantSimulatedFiscalAcceptance(req.platformAdmin.id, req.params.tenantId, input) });
  } catch (error) { next(error); }
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
