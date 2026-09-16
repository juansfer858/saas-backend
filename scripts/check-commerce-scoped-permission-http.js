'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const { buildCommerceScopeLabRouter } = require('../src/modules/platform/rbac/commerce-scope-lab.routes');

async function main() {
  const app = express();

  app.use((req, _res, next) => {
    const tenantId = String(req.header('x-actor-tenant') || '').trim();
    const userId = String(req.header('x-user-id') || '').trim();
    if (tenantId) req.tenantId = tenantId;
    if (userId) req.user = { id: userId, tenantId, rol: 'VENDEDOR' };
    next();
  });

  const assignedByUser = new Map([
    ['user-caja-01', ['register-01']],
    ['user-caja-02', ['register-02']]
  ]);

  const router = buildCommerceScopeLabRouter({
    hasPermission: async (_tenantId, _actor, code) => code === 'VENTAS.VER',
    hydrateContext: async ({ tenantId, userId, resourceTenantId, registerId }) => ({
      actorTenantId: tenantId,
      resourceTenantId,
      actorUserId: userId,
      registerId,
      assignedRegisterIds: assignedByUser.get(userId) || []
    })
  });

  app.use('/__commerce_scope_lab', router);
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      ok: false,
      code: error.code || 'ERROR',
      message: error.message,
      details: error.details || null
    });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}/__commerce_scope_lab`;

    async function request({ actorTenant = 'tenant-a', userId = 'user-caja-01', resourceTenant = 'tenant-a', registerId = 'register-01' } = {}) {
      const response = await fetch(`${base}/resource-tenants/${resourceTenant}/registers/${registerId}`, {
        headers: {
          'x-actor-tenant': actorTenant,
          'x-user-id': userId
        }
      });
      const body = await response.json();
      return { response, body };
    }

    const own = await request();
    assert.equal(own.response.status, 200, 'Caja 01 debe poder leer su propia caja');
    assert.equal(own.body.ok, true);
    assert.equal(own.body.registerId, 'register-01');

    const otherRegister = await request({ registerId: 'register-02' });
    assert.equal(otherRegister.response.status, 403, 'Caja 01 no debe poder leer Caja 02');
    assert.equal(otherRegister.body.code, 'AUTH_SCOPE_FORBIDDEN');

    const crossTenant = await request({ resourceTenant: 'tenant-b', registerId: 'register-01' });
    assert.equal(crossTenant.response.status, 403, 'Un recurso de otro tenant debe negarse siempre');
    assert.equal(crossTenant.body.code, 'AUTH_SCOPE_FORBIDDEN');

    const secondCashierOwn = await request({ userId: 'user-caja-02', registerId: 'register-02' });
    assert.equal(secondCashierOwn.response.status, 200, 'Caja 02 debe poder leer su propia caja');

    const noActor = await fetch(`${base}/resource-tenants/tenant-a/registers/register-01`, {
      headers: { 'x-actor-tenant': 'tenant-a' }
    });
    const noActorBody = await noActor.json();
    assert.equal(noActor.status, 401, 'Sin usuario autenticado debe fallar');
    assert.equal(noActorBody.code, 'AUTH_REQUIRED');

    console.log('COMMERCE_SCOPED_PERMISSION_HTTP_OK');
    console.log('Caja 01 -> Caja 01: 200');
    console.log('Caja 01 -> Caja 02: 403 AUTH_SCOPE_FORBIDDEN');
    console.log('Tenant A -> Tenant B: 403 AUTH_SCOPE_FORBIDDEN');
    console.log('Caja 02 -> Caja 02: 200');
    console.log('Sin actor: 401 AUTH_REQUIRED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
