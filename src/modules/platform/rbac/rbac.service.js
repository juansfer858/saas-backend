const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const verticalRegistry = require('../verticals/vertical-registry');

const CORE_MODULES = ['DASHBOARD','VENTAS','COMPRAS','INVENTARIO','TESORERIA','CARTERA','CONTABILIDAD','TERCEROS','CONFIGURACION','DIAN','NOMINA','USUARIOS','REPORTES','IMPUESTOS'];
const ACTIONS = ['VER','CREAR','EDITAR','ANULAR','EMITIR','PAGAR','AJUSTAR','CERRAR','REABRIR','ADMINISTRAR'];

// Se mantienen mutables por compatibilidad con instaladores de verticales,
// pero el catálogo visible/efectivo se filtra por los verticales activos de cada tenant.
const MODULES = [...CORE_MODULES];
const MODULE_VERTICAL = new Map();
const ROLE_VERTICAL = new Map();

const BASE_ROLES = {
  ADMIN: ['*'],
  CONTADOR: [
    'DASHBOARD.VER','CONTABILIDAD.VER','CONTABILIDAD.CREAR','CONTABILIDAD.EDITAR','CONTABILIDAD.ANULAR','CONTABILIDAD.CERRAR',
    'REPORTES.VER','IMPUESTOS.VER','IMPUESTOS.EDITAR','TERCEROS.VER','CARTERA.VER','DIAN.VER','NOMINA.VER'
  ],
  AUXILIAR: [
    'DASHBOARD.VER','VENTAS.VER','VENTAS.CREAR','VENTAS.EDITAR','VENTAS.EMITIR','COMPRAS.VER','COMPRAS.CREAR','COMPRAS.EDITAR','COMPRAS.EMITIR',
    'CARTERA.VER','TESORERIA.VER','TESORERIA.PAGAR','TERCEROS.VER','TERCEROS.CREAR','INVENTARIO.VER'
  ],
  VENDEDOR: ['DASHBOARD.VER','VENTAS.VER','VENTAS.CREAR','VENTAS.EDITAR','VENTAS.EMITIR','TERCEROS.VER','INVENTARIO.VER'],
  BODEGUERO: ['DASHBOARD.VER','INVENTARIO.VER','INVENTARIO.CREAR','INVENTARIO.EDITAR','INVENTARIO.AJUSTAR','COMPRAS.VER']
};

function permissionCode(module, action) {
  return `${String(module).toUpperCase()}.${String(action).toUpperCase()}`;
}

function normalizeVertical(value) {
  if (!value) return null;
  return verticalRegistry.normalizeVerticalCode(value) || String(value).trim().toUpperCase();
}

function registerVerticalRbac(verticalValue, modules = [], roles = {}) {
  const vertical = normalizeVertical(verticalValue);
  if (!vertical) throw new Error('Vertical RBAC inválido');
  for (const raw of modules) {
    const module = String(raw || '').trim().toUpperCase();
    if (!module) continue;
    if (!MODULES.includes(module)) MODULES.push(module);
    MODULE_VERTICAL.set(module, vertical);
  }
  for (const [rawCode, grants] of Object.entries(roles || {})) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) continue;
    BASE_ROLES[code] = [...(grants || [])];
    ROLE_VERTICAL.set(code, vertical);
  }
  BASE_ROLES.ADMIN = ['*'];
}

async function tenantVerticalCodes(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nicho: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');

  const result = new Set();
  const rawNicho = String(tenant.nicho || '').trim().toUpperCase();
  const legacy = verticalRegistry.normalizeVerticalCode(rawNicho);
  if (legacy) result.add(legacy);
  // Compatibilidad con tenants QA/legacy nombrados RESTAURANTE_QA, RESTAURANT_TEST, BIKE_QA, etc.
  if (!legacy && /^RESTAURANT(?:E)?(?:_|$)/.test(rawNicho)) result.add('RESTAURANT');
  if (!legacy && /^BIKE(?:_|$)/.test(rawNicho)) result.add('BIKE');

  if (client.tenantVerticalEntitlement?.findMany) {
    const rows = await client.tenantVerticalEntitlement.findMany({
      where: { tenantId, state: 'ACTIVE' },
      select: { verticalCode: true }
    });
    for (const row of rows) {
      const code = verticalRegistry.normalizeVerticalCode(row.verticalCode);
      if (code) result.add(code);
    }
  }

  // Compatibilidad para restaurantes creados antes del registry de verticales.
  if (!result.has('RESTAURANT') && client.restaurantConfig?.findUnique) {
    const restaurant = await client.restaurantConfig.findUnique({ where: { tenantId }, select: { tenantId: true } });
    if (restaurant) result.add('RESTAURANT');
  }
  return result;
}

async function allowedModulesForTenant(tenantId, client = prisma) {
  const verticals = await tenantVerticalCodes(tenantId, client);
  return MODULES.filter((module) => {
    const owner = MODULE_VERTICAL.get(module);
    return !owner || verticals.has(owner);
  });
}

async function ensurePermissions(client = prisma) {
  const all = [];
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const code = permissionCode(module, action);
      const permission = await client.rbacPermission.upsert({
        where: { code },
        create: { code, module, action, description: `${action} en ${module}` },
        update: { module, action }
      });
      all.push(permission);
    }
  }
  return all;
}

async function listPermissions(tenantId, client = prisma) {
  await ensurePermissions(client);
  const allowed = await allowedModulesForTenant(tenantId, client);
  return client.rbacPermission.findMany({
    where: { module: { in: allowed } },
    orderBy: [{ module: 'asc' }, { action: 'asc' }]
  });
}

async function ensureTenantRoles(tenantId, client = prisma) {
  const [permissions, verticals, allowedModules] = await Promise.all([
    ensurePermissions(client),
    tenantVerticalCodes(tenantId, client),
    allowedModulesForTenant(tenantId, client)
  ]);
  const allowedModuleSet = new Set(allowedModules);
  const allowedPermissions = permissions.filter((p) => allowedModuleSet.has(p.module));
  const byCode = new Map(allowedPermissions.map((p) => [p.code, p]));
  const roles = {};

  for (const [code, grants] of Object.entries(BASE_ROLES)) {
    const owner = ROLE_VERTICAL.get(code) || null;
    if (owner && !verticals.has(owner)) {
      // Limpia roles de otros proyectos que fueron sembrados cuando el catálogo era global.
      await client.rbacRole.updateMany({
        where: { tenantId, code },
        data: { active: false, vertical: owner, system: true }
      });
      continue;
    }

    const role = await client.rbacRole.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        code,
        name: code === 'ADMIN' ? 'Administrador' : code[0] + code.slice(1).toLowerCase(),
        vertical: owner,
        system: true,
        active: true
      },
      update: { system: true, active: true, vertical: owner }
    });
    roles[code] = role;

    const desired = grants.includes('*')
      ? allowedPermissions
      : grants.map((x) => byCode.get(x)).filter(Boolean);
    const desiredIds = desired.map((permission) => permission.id);

    if (desired.length) {
      await client.rbacRolePermission.createMany({
        data: desired.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true
      });
      await client.rbacRolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: desiredIds } }
      });
    } else {
      await client.rbacRolePermission.deleteMany({ where: { roleId: role.id } });
    }
  }
  return roles;
}

async function audit(client, { tenantId, actorUserId, targetUserId = null, action, metadata = null }) {
  await client.rbacAudit.create({ data: { tenantId, actorUserId, targetUserId, action, metadata } });
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId: actorUserId,
      entidad: 'RBAC',
      entidadId: targetUserId || actorUserId,
      accion: action,
      metadata
    }
  });
}

async function roleAllowedForTenant(role, tenantId, client = prisma) {
  if (!role?.vertical) return true;
  const verticals = await tenantVerticalCodes(tenantId, client);
  const normalized = normalizeVertical(role.vertical);
  return !normalized || verticals.has(normalized);
}

async function permissionAllowedForTenant(permission, tenantId, client = prisma) {
  if (!permission) return false;
  const allowed = new Set(await allowedModulesForTenant(tenantId, client));
  return allowed.has(permission.module);
}

async function effectivePermissions(tenantId, user) {
  if (!user) return new Set();
  if (['ADMIN', 'SUPER_ADMIN'].includes(user.rol)) return new Set(['*']);
  await ensureTenantRoles(tenantId);

  const assignments = await prisma.rbacUserRole.findMany({
    where: { tenantId, userId: user.id },
    include: { role: { include: { permissions: { include: { permission: true } } } } }
  });

  let roleAssignments = assignments;
  if (!roleAssignments.length) {
    const legacyRole = await prisma.rbacRole.findFirst({
      where: { tenantId, code: user.rol, active: true },
      include: { permissions: { include: { permission: true } } }
    });
    if (legacyRole) roleAssignments = [{ role: legacyRole }];
  }

  const allowedModules = new Set(await allowedModulesForTenant(tenantId));
  const result = new Set();
  for (const assignment of roleAssignments) {
    if (!assignment.role?.active) continue;
    if (!(await roleAllowedForTenant(assignment.role, tenantId))) continue;
    for (const rp of assignment.role.permissions || []) {
      if (allowedModules.has(rp.permission.module)) result.add(rp.permission.code);
    }
  }

  const overrides = await prisma.rbacUserPermissionOverride.findMany({
    where: { tenantId, userId: user.id },
    include: { permission: true }
  });
  for (const override of overrides) {
    if (!allowedModules.has(override.permission.module)) continue;
    if (override.effect === 'DENY') result.delete(override.permission.code);
    else result.add(override.permission.code);
  }
  return result;
}

async function hasPermission(tenantId, user, code) {
  const perms = await effectivePermissions(tenantId, user);
  return perms.has('*') || perms.has(code);
}

async function listRoles(tenantId) {
  await ensureTenantRoles(tenantId);
  const [verticals, allowedModules] = await Promise.all([
    tenantVerticalCodes(tenantId),
    allowedModulesForTenant(tenantId)
  ]);
  const allowedModuleSet = new Set(allowedModules);
  const roles = await prisma.rbacRole.findMany({
    where: {
      tenantId,
      active: true,
      OR: [
        { vertical: null },
        { vertical: { in: [...verticals] } }
      ]
    },
    include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } },
    orderBy: [{ system: 'desc' }, { name: 'asc' }]
  });
  return roles.map((role) => ({
    ...role,
    permissions: (role.permissions || []).filter((rp) => allowedModuleSet.has(rp.permission.module))
  }));
}

async function createRole(tenantId, actorUserId, input) {
  const requestedVertical = input.vertical ? normalizeVertical(input.vertical) : null;
  if (input.vertical && !verticalRegistry.getVertical(requestedVertical)) {
    throw new AppError(400, 'Vertical inválido para este rol', 'RBAC_ROLE_VERTICAL_INVALID');
  }
  if (requestedVertical) {
    const verticals = await tenantVerticalCodes(tenantId);
    if (!verticals.has(requestedVertical)) {
      throw new AppError(409, 'Ese vertical no está activo para esta empresa', 'RBAC_ROLE_VERTICAL_NOT_ENTITLED');
    }
  }

  return prisma.$transaction(async (tx) => {
    const role = await tx.rbacRole.create({
      data: {
        tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description || null,
        vertical: requestedVertical,
        system: false,
        active: true
      }
    });
    await audit(tx, { tenantId, actorUserId, action: 'ROLE_CREATE', metadata: { roleId: role.id, code: role.code, vertical: role.vertical } });
    return role;
  });
}

async function setRolePermissions(tenantId, actorUserId, roleId, permissionCodes) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.rbacRole.findFirst({ where: { id: roleId, tenantId, active: true } });
    if (!role) throw new AppError(404, 'Rol no encontrado', 'RBAC_ROLE_NOT_FOUND');
    if (!(await roleAllowedForTenant(role, tenantId, tx))) throw new AppError(403, 'El rol pertenece a otro vertical', 'RBAC_ROLE_VERTICAL_FORBIDDEN');

    const allowedModules = new Set(await allowedModulesForTenant(tenantId, tx));
    const permissions = await tx.rbacPermission.findMany({ where: { code: { in: permissionCodes } } });
    if (permissions.length !== new Set(permissionCodes).size) throw new AppError(400, 'Uno o más permisos no existen', 'RBAC_PERMISSION_INVALID');
    if (permissions.some((permission) => !allowedModules.has(permission.module))) {
      throw new AppError(403, 'Uno o más permisos pertenecen a otro vertical', 'RBAC_PERMISSION_VERTICAL_FORBIDDEN');
    }

    await tx.rbacRolePermission.deleteMany({ where: { roleId } });
    if (permissions.length) await tx.rbacRolePermission.createMany({ data: permissions.map((p) => ({ roleId, permissionId: p.id })) });
    await audit(tx, { tenantId, actorUserId, action: 'ROLE_PERMISSIONS_SET', metadata: { roleId, permissionCodes } });
    return tx.rbacRole.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  });
}

async function deleteRole(tenantId, actorUserId, roleId) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.rbacRole.findFirst({
      where: { id: roleId, tenantId },
      include: { _count: { select: { assignments: true } } }
    });
    if (!role) throw new AppError(404, 'Rol no encontrado', 'RBAC_ROLE_NOT_FOUND');
    if (role.system) throw new AppError(409, 'Los roles del sistema no se pueden eliminar', 'RBAC_SYSTEM_ROLE_DELETE_FORBIDDEN');
    if (role._count.assignments > 0) {
      throw new AppError(409, 'Este rol está asignado a usuarios. Retira esas asignaciones antes de eliminarlo.', 'RBAC_ROLE_ASSIGNED');
    }
    const legacyUsers = await tx.user.count({ where: { tenantId, rol: role.code } });
    if (legacyUsers > 0) {
      throw new AppError(409, 'Este rol todavía está usado como rol principal por uno o más usuarios.', 'RBAC_ROLE_LEGACY_ASSIGNED');
    }
    await audit(tx, {
      tenantId,
      actorUserId,
      action: 'ROLE_DELETE',
      metadata: { roleId: role.id, code: role.code, name: role.name, vertical: role.vertical }
    });
    await tx.rbacRole.delete({ where: { id: role.id } });
    return { id: role.id, code: role.code, deleted: true };
  });
}

async function setUserRoles(tenantId, actorUserId, userId, roleIds) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado', 'RBAC_USER_NOT_FOUND');
    const verticals = await tenantVerticalCodes(tenantId, tx);
    const roles = await tx.rbacRole.findMany({
      where: {
        tenantId,
        id: { in: roleIds },
        active: true,
        OR: [{ vertical: null }, { vertical: { in: [...verticals] } }]
      }
    });
    if (roles.length !== new Set(roleIds).size) throw new AppError(400, 'Uno o más roles no pertenecen a la empresa o a sus verticales activos', 'RBAC_ROLE_INVALID');
    await tx.rbacUserRole.deleteMany({ where: { tenantId, userId } });
    if (roles.length) await tx.rbacUserRole.createMany({ data: roles.map((r) => ({ tenantId, userId, roleId: r.id })) });
    await audit(tx, { tenantId, actorUserId, targetUserId: userId, action: 'USER_ROLES_SET', metadata: { roleIds } });
    return roles;
  });
}

async function setUserOverride(tenantId, actorUserId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado', 'RBAC_USER_NOT_FOUND');
    const permission = await tx.rbacPermission.findUnique({ where: { code: input.permissionCode } });
    if (!permission) throw new AppError(400, 'Permiso no encontrado', 'RBAC_PERMISSION_INVALID');
    if (!(await permissionAllowedForTenant(permission, tenantId, tx))) {
      throw new AppError(403, 'Ese permiso pertenece a otro vertical', 'RBAC_PERMISSION_VERTICAL_FORBIDDEN');
    }
    const row = await tx.rbacUserPermissionOverride.upsert({
      where: { tenantId_userId_permissionId: { tenantId, userId, permissionId: permission.id } },
      create: { tenantId, userId, permissionId: permission.id, effect: input.effect, grantedByUserId: actorUserId, reason: input.reason || null },
      update: { effect: input.effect, grantedByUserId: actorUserId, reason: input.reason || null }
    });
    await audit(tx, { tenantId, actorUserId, targetUserId: userId, action: 'USER_PERMISSION_OVERRIDE', metadata: { permissionCode: input.permissionCode, effect: input.effect, reason: input.reason || null } });
    return row;
  });
}

module.exports = {
  CORE_MODULES,
  MODULES,
  ACTIONS,
  BASE_ROLES,
  MODULE_VERTICAL,
  ROLE_VERTICAL,
  permissionCode,
  registerVerticalRbac,
  tenantVerticalCodes,
  allowedModulesForTenant,
  ensurePermissions,
  listPermissions,
  ensureTenantRoles,
  effectivePermissions,
  hasPermission,
  listRoles,
  createRole,
  setRolePermissions,
  deleteRole,
  setUserRoles,
  setUserOverride
};
