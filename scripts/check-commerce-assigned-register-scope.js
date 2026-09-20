'use strict';

const assert = require('assert');
const {
  resolveAssignedRegisterIds,
  hydrateAssignedRegisterScopeContext
} = require('../src/modules/platform/rbac/commerce-scope-resolver.service');
const { scopeMatches, SCOPE_TYPES } = require('../src/modules/platform/rbac/scope-policy.service');

const calls = [];
const fakeClient = {
  aperturaCierreCaja: {
    async findMany(args) {
      calls.push(args);
      return [
        { cajaBancoId: 'register-1' },
        { cajaBancoId: 'register-1' },
        { cajaBancoId: 'register-2' }
      ];
    }
  }
};

(async () => {
  const ids = await resolveAssignedRegisterIds('tenant-a', 'user-1', fakeClient);
  assert.deepStrictEqual(ids, ['register-1', 'register-2']);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].where, {
    tenantId: 'tenant-a',
    userId: 'user-1',
    estado: 'ABIERTA',
    cajaBanco: { tipo: 'CAJA', activo: true }
  });

  const context = await hydrateAssignedRegisterScopeContext({
    tenantId: 'tenant-a',
    userId: 'user-1',
    resourceTenantId: 'tenant-a',
    registerId: 'register-2'
  }, fakeClient);

  assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER }, context), true);
  assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER }, { ...context, registerId: 'register-3' }), false);
  assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER }, { ...context, resourceTenantId: 'tenant-b' }), false);

  const missing = await resolveAssignedRegisterIds('', 'user-1', fakeClient);
  assert.deepStrictEqual(missing, []);

  console.log('COMMERCE_ASSIGNED_REGISTER_SCOPE_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
