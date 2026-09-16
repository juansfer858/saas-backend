'use strict';

const express = require('express');
const { AppError } = require('../../../utils/app-error');
const { securityUser } = require('../../../middleware/require-permission');
const shellService = require('./dynamic-shell.service');

function buildDynamicShellLabRouter({
  resolveShell = shellService.resolveDynamicShell,
  actorResolver = securityUser
} = {}) {
  const router = express.Router();

  router.get('/me', async (req, res, next) => {
    try {
      const actor = actorResolver(req);
      if (!actor) throw new AppError(401, 'Autenticación requerida', 'AUTH_REQUIRED');
      if (!req.tenantId) throw new AppError(403, 'Tenant requerido', 'AUTH_TENANT_REQUIRED');

      const data = await resolveShell({
        tenantId: req.tenantId,
        user: actor,
        shell: req.query.shell || 'FULL',
        device: req.query.device || 'DESKTOP'
      });

      res.json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { buildDynamicShellLabRouter };
