'use strict';

const express = require('express');
const { buildRequireScopedPermission } = require('./require-scoped-permission.middleware');
const { hydrateAssignedRegisterScopeContext } = require('./commerce-scope-resolver.service');

function buildCommerceScopeLabRouter({
  hasPermission,
  hydrateContext = hydrateAssignedRegisterScopeContext
} = {}) {
  const router = express.Router();

  const guard = buildRequireScopedPermission({
    permissionCode: 'VENTAS.VER',
    hasPermission,
    resolveGrants: async () => [{ type: 'ASSIGNED_REGISTER' }],
    resolveContext: async ({ req, actor, tenantId }) => hydrateContext({
      tenantId,
      userId: actor.id,
      resourceTenantId: req.params.resourceTenantId,
      registerId: req.params.registerId
    })
  });

  router.get('/resource-tenants/:resourceTenantId/registers/:registerId', guard, (req, res) => {
    res.status(200).json({
      ok: true,
      registerId: req.params.registerId,
      scope: req.scopedAuthorization
    });
  });

  return router;
}

module.exports = { buildCommerceScopeLabRouter };
