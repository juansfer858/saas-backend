'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');
const registry = require('./module-registry.service');

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Configuración de módulos inválida', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const querySchema = z.object({
  shell: z.enum(['FULL', 'OPERATION', 'FISCAL', 'TRANSITION']).default('FULL'),
  device: z.enum(['DESKTOP', 'TABLET', 'POS', 'MOBILE']).default('DESKTOP')
});

const moduleStateSchema = z.object({
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()).optional().nullable()
});

function buildModuleRegistryRouter({ service = registry, adminGuard = requirePermission('CONFIGURACION.ADMINISTRAR') } = {}) {
  const router = express.Router();

  router.get('/visible', async (req, res, next) => {
    try {
      if (!req.user) throw new AppError(401, 'Autenticación requerida', 'AUTH_REQUIRED');
      if (!req.tenantId) throw new AppError(403, 'Tenant requerido', 'AUTH_TENANT_REQUIRED');
      const query = parse(querySchema, {
        shell: String(req.query.shell || 'FULL').toUpperCase(),
        device: String(req.query.device || 'DESKTOP').toUpperCase()
      });
      const data = await service.resolveVisibleModules({
        tenantId: req.tenantId,
        user: req.user,
        shell: query.shell,
        device: query.device
      });
      res.json({ ok: true, data });
    } catch (error) { next(error); }
  });

  router.get('/admin/states', adminGuard, async (req, res, next) => {
    try {
      res.json({ ok: true, data: await service.listTenantModuleStates(req.tenantId) });
    } catch (error) { next(error); }
  });

  router.put('/admin/modules/:moduleCode', adminGuard, async (req, res, next) => {
    try {
      const input = parse(moduleStateSchema, req.body);
      const data = await service.setTenantModuleState({
        tenantId: req.tenantId,
        actorUserId: req.userId,
        moduleCode: req.params.moduleCode,
        enabled: input.enabled,
        settings: input.settings || null
      });
      res.json({ ok: true, data });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { buildModuleRegistryRouter, querySchema, moduleStateSchema };
