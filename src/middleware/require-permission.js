const { AppError } = require('../utils/app-error');
const rbac = require('../modules/platform/rbac/rbac.service');

function requirePermission(code) {
  return async (req, _res, next) => {
    try {
      const allowed = await rbac.hasPermission(req.tenantId, req.user, code);
      if (!allowed) return next(new AppError(403, `Permiso requerido: ${code}`, 'AUTH_PERMISSION_FORBIDDEN', { permission: code }));
      next();
    } catch (error) {
      next(error);
    }
  };
}

function permissionForRequest(req) {
  const path = String(req.path || '').toLowerCase();
  let module = null;
  if (path.startsWith('/usuarios')) module = 'USUARIOS';
  else if (path.startsWith('/terceros')) module = 'TERCEROS';
  else if (path.startsWith('/inventario')) module = 'INVENTARIO';
  else if (path.startsWith('/tesoreria') || path.startsWith('/pagos')) module = 'TESORERIA';
  else if (path.startsWith('/comercial/ventas')) module = 'VENTAS';
  else if (path.startsWith('/comercial/compras')) module = 'COMPRAS';
  else if (path.startsWith('/comercial')) module = 'VENTAS';
  else if (path.startsWith('/contabilidad')) module = 'CONTABILIDAD';
  else if (path.startsWith('/dian')) module = 'DIAN';
  else if (path.startsWith('/nomina')) module = 'NOMINA';
  else if (path.startsWith('/impresion') || path.startsWith('/seguridad')) module = 'CONFIGURACION';
  if (!module) return null;

  let action = 'VER';
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'POST') {
    if (/\/emitir(?:\/|$)/.test(path)) action = 'EMITIR';
    else if (/\/anular|\/revers/.test(path)) action = 'ANULAR';
    else if (/\/pagar|\/pagos|\/aplicar/.test(path)) action = 'PAGAR';
    else if (/\/ajust/.test(path)) action = 'AJUSTAR';
    else if (/\/cerrar|\/close/.test(path)) action = 'CERRAR';
    else if (/\/reabrir|\/reopen/.test(path)) action = 'REABRIR';
    else action = 'CREAR';
  } else if (method === 'PATCH' || method === 'PUT') action = 'EDITAR';
  else if (method === 'DELETE') action = 'ANULAR';
  return `${module}.${action}`;
}

async function enforceTenantPermissions(req, _res, next) {
  try {
    if (!req.user || ['ADMIN', 'SUPER_ADMIN'].includes(req.user.rol)) return next();
    const code = permissionForRequest(req);
    if (!code) return next();
    const allowed = await rbac.hasPermission(req.tenantId, req.user, code);
    if (!allowed) return next(new AppError(403, `Permiso requerido: ${code}`, 'AUTH_PERMISSION_FORBIDDEN', { permission: code }));
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requirePermission, permissionForRequest, enforceTenantPermissions };
