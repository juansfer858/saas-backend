'use strict';

const assert = require('assert');
const {
  SCOPE_TYPES,
  normalizeScopeGrant,
  scopeMatches,
  authorizeScopedAction
} = require('../src/modules/platform/rbac/scope-policy.service');

function ctx(overrides = {}) {
  return {
    actorTenantId: 'tenant-a',
    resourceTenantId: 'tenant-a',
    actorUserId: 'user-1',
    resourceOwnerUserId: 'user-1',
    storeId: 'store-1',
    registerId: 'register-1',
    warehouseId: 'warehouse-1',
    resourceId: 'resource-1',
    assigneeUserId: 'user-1',
    assignedStoreIds: ['store-1'],
    assignedRegisterIds: ['register-1'],
    assignedWarehouseIds: ['warehouse-1'],
    assignedResourceIds: ['resource-1'],
    ...overrides
  };
}

assert.deepStrictEqual(normalizeScopeGrant({ type: 'tenant' }), { type: SCOPE_TYPES.TENANT, resourceId: null });
assert.strictEqual(normalizeScopeGrant({ type: 'unknown' }), null);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.TENANT }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.TENANT }, ctx({ resourceTenantId: 'tenant-b' })), false);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER }, ctx({ registerId: 'register-2' })), false);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_REGISTER, resourceId: 'register-2' }, ctx({ registerId: 'register-2', assignedRegisterIds: [] })), true);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_WAREHOUSE }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED_WAREHOUSE }, ctx({ warehouseId: 'warehouse-2' })), false);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.STORE }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.STORE }, ctx({ storeId: 'store-2' })), false);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.SELF }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.SELF }, ctx({ resourceOwnerUserId: 'user-2' })), false);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED }, ctx()), true);
assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.ASSIGNED }, ctx({ assigneeUserId: 'user-2', resourceId: 'resource-2' })), false);

assert.strictEqual(scopeMatches({ type: SCOPE_TYPES.NONE }, ctx()), false);
assert.strictEqual(scopeMatches({ type: 'UNKNOWN' }, ctx()), false);

assert.strictEqual(authorizeScopedAction({
  permissionAllowed: false,
  grants: [{ type: SCOPE_TYPES.TENANT }],
  context: ctx()
}), false);

assert.strictEqual(authorizeScopedAction({
  permissionAllowed: true,
  grants: [],
  context: ctx()
}), false);

assert.strictEqual(authorizeScopedAction({
  permissionAllowed: true,
  grants: [{ type: SCOPE_TYPES.ASSIGNED_REGISTER }],
  context: ctx()
}), true);

assert.strictEqual(authorizeScopedAction({
  permissionAllowed: true,
  grants: [{ type: SCOPE_TYPES.ASSIGNED_REGISTER }],
  context: ctx({ registerId: 'register-2' })
}), false);

console.log('COMMERCE_SCOPE_CONTRACT_OK');
