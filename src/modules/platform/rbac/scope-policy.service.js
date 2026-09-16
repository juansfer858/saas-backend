'use strict';

const SCOPE_TYPES = Object.freeze({
  TENANT: 'TENANT',
  STORE: 'STORE',
  ASSIGNED_REGISTER: 'ASSIGNED_REGISTER',
  ASSIGNED_WAREHOUSE: 'ASSIGNED_WAREHOUSE',
  SELF: 'SELF',
  ASSIGNED: 'ASSIGNED',
  NONE: 'NONE'
});

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))];
}

function tenantMatches(context = {}) {
  const actorTenantId = context.actorTenantId ? String(context.actorTenantId) : null;
  const resourceTenantId = context.resourceTenantId ? String(context.resourceTenantId) : null;
  return Boolean(actorTenantId && resourceTenantId && actorTenantId === resourceTenantId);
}

function explicitOrAssigned(resourceId, explicitResourceId, assignedIds) {
  if (!resourceId) return false;
  const target = String(resourceId);
  if (explicitResourceId && target === String(explicitResourceId)) return true;
  return uniqueStrings(assignedIds).includes(target);
}

function normalizeScopeGrant(grant) {
  if (!grant || typeof grant !== 'object') return null;
  const type = String(grant.type || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(SCOPE_TYPES, type)) return null;
  return {
    type,
    resourceId: grant.resourceId ? String(grant.resourceId) : null
  };
}

function scopeMatches(rawGrant, context = {}) {
  const grant = normalizeScopeGrant(rawGrant);
  if (!grant) return false;
  if (!tenantMatches(context)) return false;

  switch (grant.type) {
    case SCOPE_TYPES.NONE:
      return false;

    case SCOPE_TYPES.TENANT:
      return true;

    case SCOPE_TYPES.STORE:
      return explicitOrAssigned(context.storeId, grant.resourceId, context.assignedStoreIds);

    case SCOPE_TYPES.ASSIGNED_REGISTER:
      return explicitOrAssigned(context.registerId, grant.resourceId, context.assignedRegisterIds);

    case SCOPE_TYPES.ASSIGNED_WAREHOUSE:
      return explicitOrAssigned(context.warehouseId, grant.resourceId, context.assignedWarehouseIds);

    case SCOPE_TYPES.SELF: {
      const actorUserId = context.actorUserId ? String(context.actorUserId) : null;
      const ownerUserId = context.resourceOwnerUserId ? String(context.resourceOwnerUserId) : null;
      return Boolean(actorUserId && ownerUserId && actorUserId === ownerUserId);
    }

    case SCOPE_TYPES.ASSIGNED: {
      const actorUserId = context.actorUserId ? String(context.actorUserId) : null;
      const assigneeUserId = context.assigneeUserId ? String(context.assigneeUserId) : null;
      if (actorUserId && assigneeUserId && actorUserId === assigneeUserId) return true;
      if (!context.resourceId) return false;
      return uniqueStrings(context.assignedResourceIds).includes(String(context.resourceId));
    }

    default:
      return false;
  }
}

function authorizeScopedAction({ permissionAllowed, grants, context } = {}) {
  if (!permissionAllowed) return false;
  const normalizedGrants = (Array.isArray(grants) ? grants : []).map(normalizeScopeGrant).filter(Boolean);
  if (!normalizedGrants.length) return false;
  return normalizedGrants.some((grant) => scopeMatches(grant, context));
}

module.exports = {
  SCOPE_TYPES,
  normalizeScopeGrant,
  scopeMatches,
  authorizeScopedAction
};
