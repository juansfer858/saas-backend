'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');
const accessService = require('./commerce-access-admin.service');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'Datos de administración de accesos inválidos', 'VALIDATION_ERROR', result.error.flatten());
  }
  return result.data;
}

const scopeSchema = z.object({
  subjectType: z.enum(['ROLE', 'USER']),
  subjectId: z.string().uuid(),
  permissionCode: z.string().trim().min(3).max(120),
  type: z.enum(['TENANT', 'STORE', 'ASSIGNED_REGISTER', 'ASSIGNED_WAREHOUSE', 'SELF', 'ASSIGNED', 'NONE']),
  resourceId: z.string().trim().min(1).max(160).optional().nullable(),
  reason: z.string().trim().max(300).optional().nullable()
});

const disableScopeSchema = z.object({
  reason: z.string().trim().max(300).optional().nullable()
});

function buildCommerceAccessAdminRouter({
  service = accessService,
  adminGuard = requirePermission('CONFIGURACION.ADMINISTRAR')
} = {}) {
  const router = express.Router();

  router.get('/overview', adminGuard, async (req, res, next) => {
    try {
      res.json({ ok: true, data: await service.listCommerceAccessOverview(req.tenantId) });
    } catch (error) { next(error); }
  });

  router.get('/usuarios/:userId', adminGuard, async (req, res, next) => {
    try {
      res.json({ ok: true, data: await service.getUserAccessProfile(req.tenantId, req.params.userId) });
    } catch (error) { next(error); }
  });

  router.post('/scopes', adminGuard, async (req, res, next) => {
    try {
      const input = parse(scopeSchema, req.body);
      const data = await service.assignScope({
        tenantId: req.tenantId,
        actorUserId: req.userId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permissionCode: input.permissionCode,
        grant: { type: input.type, resourceId: input.resourceId || null },
        reason: input.reason || null
      });
      res.status(201).json({ ok: true, data });
    } catch (error) { next(error); }
  });

  router.patch('/scopes/:grantId/disable', adminGuard, async (req, res, next) => {
    try {
      const input = parse(disableScopeSchema, req.body || {});
      const data = await service.disableScope({
        tenantId: req.tenantId,
        actorUserId: req.userId,
        grantId: req.params.grantId,
        reason: input.reason || null
      });
      res.json({ ok: true, data });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = {
  buildCommerceAccessAdminRouter,
  scopeSchema,
  disableScopeSchema
};
