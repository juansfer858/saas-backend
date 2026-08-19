const express = require('express');
const { z } = require('zod');
const service = require('./rbac.service');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de seguridad inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const roleSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/i),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional().nullable(),
  vertical: z.string().trim().max(60).optional().nullable()
});
const rolePermissionsSchema = z.object({ permissionCodes: z.array(z.string().trim()).max(200) });
const userRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).max(20) });
const overrideSchema = z.object({
  permissionCode: z.string().trim().min(3),
  effect: z.enum(['ALLOW', 'DENY']),
  reason: z.string().trim().max(300).optional().nullable()
});

router.get('/permisos', requirePermission('CONFIGURACION.ADMINISTRAR'), async (_req, res, next) => {
  try {
    const data = await service.ensurePermissions();
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/roles', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listRoles(req.tenantId) }); }
  catch (error) { next(error); }
});

router.post('/roles', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createRole(req.tenantId, req.userId, parse(roleSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.put('/roles/:id/permisos', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(rolePermissionsSchema, req.body);
    res.json({ ok: true, data: await service.setRolePermissions(req.tenantId, req.userId, req.params.id, input.permissionCodes) });
  } catch (error) { next(error); }
});

router.put('/usuarios/:userId/roles', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(userRolesSchema, req.body);
    res.json({ ok: true, data: await service.setUserRoles(req.tenantId, req.userId, req.params.userId, input.roleIds) });
  } catch (error) { next(error); }
});

router.put('/usuarios/:userId/permisos', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.setUserOverride(req.tenantId, req.userId, req.params.userId, parse(overrideSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/usuarios/:userId/efectivos', requirePermission('CONFIGURACION.ADMINISTRAR'), async (req, res, next) => {
  try {
    const user = await require('../../../config/prisma').prisma.user.findFirst({ where: { id: req.params.userId, tenantId: req.tenantId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado', 'RBAC_USER_NOT_FOUND');
    const permissions = [...await service.effectivePermissions(req.tenantId, user)].sort();
    res.json({ ok: true, data: { userId: user.id, legacyRole: user.rol, permissions } });
  } catch (error) { next(error); }
});

module.exports = { rbacRouter: router };
