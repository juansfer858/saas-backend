const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const MODULES = ['DASHBOARD','VENTAS','COMPRAS','INVENTARIO','TESORERIA','CARTERA','CONTABILIDAD','TERCEROS','CONFIGURACION','DIAN','NOMINA','USUARIOS','REPORTES','IMPUESTOS'];
const ACTIONS = ['VER','CREAR','EDITAR','ANULAR','EMITIR','PAGAR','AJUSTAR','CERRAR','REABRIR','ADMINISTRAR'];

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

async function ensureTenantRoles(tenantId, client = prisma) {
  const permissions = await ensurePermissions(client);
  const byCode = new Map(permissions.map((p) => [p.code, p]));
  const roles = {};
  for (const [code, grants] of Object.entries(BASE_ROLES)) {
    const role = await client.rbacRole.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, name: code === 'ADMIN' ? 'Administrador' : code[0] + code.slice(1).toLowerCase(), system: true, active: true },
      update: { system: true, active: true }
    });
    roles[code] = role;
    const desired = grants.includes('*') ? permissions : grants.map((x) => byCode.get(x)).filter(Boolean);
    const desiredIds = desired.map((permission) => permission.id);

    // Never remove valid grants before restoring them. effectivePermissions() can run
    // concurrently for several API requests from the same PWA; the old delete-all then
    // create-all sequence exposed a brief empty-role window and produced random 403s.
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
    const legacyRole = await prisma.rbacRole.findFirst({ where: { tenantId, code: user.rol, active: true }, include: { permissions: { include: { permission: true } } } });
    if (legacyRole) roleAssignments = [{ role: legacyRole }];
  }

  const result = new Set();
  for (const assignment of roleAssignments) {
    if (!assignment.role?.active) continue;
    for (const rp of assignment.role.permissions || []) result.add(rp.permission.code);
  }

  const overrides = await prisma.rbacUserPermissionOverride.findMany({
    where: { tenantId, userId: user.id },
    include: { permission: true }
  });
  for (const override of overrides) {
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
  return prisma.rbacRole.findMany({
    where: { tenantId, active: true },
    include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } },
    orderBy: [{ system: 'desc' }, { name: 'asc' }]
  });
}

async function createRole(tenantId, actorUserId, input) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.rbacRole.create({
      data: {
        tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description || null,
        vertical: input.vertical || null,
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
    const role = await tx.rbacRole.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new AppError(404, 'Rol no encontrado', 'RBAC_ROLE_NOT_FOUND');
    const permissions = await tx.rbacPermission.findMany({ where: { code: { in: permissionCodes } } });
    if (permissions.length !== new Set(permissionCodes).size) throw new AppError(400, 'Uno o más permisos no existen', 'RBAC_PERMISSION_INVALID');
    await tx.rbacRolePermission.deleteMany({ where: { roleId } });
    if (permissions.length) await tx.rbacRolePermission.createMany({ data: permissions.map((p) => ({ roleId, permissionId: p.id })) });
    await audit(tx, { tenantId, actorUserId, action: 'ROLE_PERMISSIONS_SET', metadata: { roleId, permissionCodes } });
    return tx.rbacRole.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  });
}

async function setUserRoles(tenantId, actorUserId, userId, roleIds) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado', 'RBAC_USER_NOT_FOUND');
    const roles = await tx.rbacRole.findMany({ where: { tenantId, id: { in: roleIds }, active: true } });
    if (roles.length !== new Set(roleIds).size) throw new AppError(400, 'Uno o más roles no pertenecen a la empresa', 'RBAC_ROLE_INVALID');
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
  MODULES,
  ACTIONS,
  BASE_ROLES,
  permissionCode,
  ensurePermissions,
  ensureTenantRoles,
  effectivePermissions,
  hasPermission,
  listRoles,
  createRole,
  setRolePermissions,
  setUserRoles,
  setUserOverride
};
