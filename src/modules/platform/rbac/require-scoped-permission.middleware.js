'use strict';

const { AppError } = require('../../../utils/app-error');
const { securityUser } = require('../../../middleware/require-permission');
const rbac = require('./rbac.service');
const { authorizeScopedAction } = require('./scope-policy.service');

function assertResolver(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} debe ser una función`);
  }
}

function buildRequireScopedPermission({
  permissionCode,
  resolveGrants,
  resolveContext,
  hasPermission = rbac.hasPermission,
  actorResolver = securityUser,
  authorize = authorizeScopedAction
} = {}) {
  const code = String(permissionCode || '').trim().toUpperCase();
  if (!code) throw new TypeError('permissionCode es obligatorio');
  assertResolver('resolveGrants', resolveGrants);
  assertResolver('resolveContext', resolveContext);
  assertResolver('hasPermission', hasPermission);
  assertResolver('actorResolver', actorResolver);
  assertResolver('authorize', authorize);

  return async function requireScopedPermission(req, _res, next) {
    try {
      const actor = actorResolver(req);
      if (!actor) {
        return next(new AppError(401, 'Autenticación requerida', 'AUTH_REQUIRED'));
      }

      const tenantId = req.tenantId ? String(req.tenantId) : null;
      if (!tenantId) {
        return next(new AppError(403, 'Tenant requerido', 'AUTH_TENANT_REQUIRED'));
      }

      const permissionAllowed = await hasPermission(tenantId, actor, code);
      if (!permissionAllowed) {
        return next(new AppError(403, `Permiso requerido: ${code}`, 'AUTH_PERMISSION_FORBIDDEN', { permission: code }));
      }

      const grants = await resolveGrants({ req, actor, tenantId, permissionCode: code });
      const context = await resolveContext({ req, actor, tenantId, permissionCode: code });
      const scopedAllowed = authorize({ permissionAllowed: true, grants, context });

      if (!scopedAllowed) {
        return next(new AppError(403, `Alcance insuficiente para ${code}`, 'AUTH_SCOPE_FORBIDDEN', {
          permission: code,
          scopeTypes: (Array.isArray(grants) ? grants : []).map((grant) => grant?.type).filter(Boolean)
        }));
      }

      req.scopedAuthorization = {
        permission: code,
        grants: Array.isArray(grants) ? grants : [],
        context
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { buildRequireScopedPermission };
