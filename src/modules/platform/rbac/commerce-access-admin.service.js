'use strict';

const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const rbac = require('./rbac.service');
const persistentScopes = require('./persistent-scope.service');
const { SCOPE_TYPES } = require('./scope-policy.service');

const COMMERCE_MODULES = Object.freeze([
  'DASHBOARD',
  'VENTAS',
  'COMPRAS',
  'INVENTARIO',
  'TESORERIA',
  'CARTERA',
  'TERCEROS',
  'CONTABILIDAD',
  'REPORTES',
  'CONFIGURACION',
  'DIAN'
]);

function cleanId(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function groupScopeRows(rows = []) {
  const grouped = {};
  for (const row of rows) {
    if (!row?.permissionCode || !row?.scopeType) continue;
    if (!grouped[row.permissionCode]) grouped[row.permissionCode] = [];
    const grant = { type: row.scopeType, resourceId: row.resourceId || null };
    const key = `${grant.type}:${grant.resourceId || '*'}`;
    if (!grouped[row.permissionCode].some((existing) => `${existing.type}:${existing.resourceId || '*'}` === key)) {
      grouped[row.permissionCode].push(grant);
    }
  }
  return grouped;
}

async function requireTenantUser(tenantId, userId, client = prisma) {
  const safeTenantId = cleanId(tenantId);
  const safeUserId = cleanId(userId);
  if (!safeTenantId || !safeUserId) throw new AppError(400, 'tenantId y userId son obligatorios', 'COMMERCE_ACCESS_INPUT_REQUIRED');
  const user = await client.user.findFirst({
    where: { id: safeUserId, tenantId: safeTenantId, activo: true },
    select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true }
  });
  if (!user) throw new AppError(404, 'Usuario no encontrado', 'COMMERCE_ACCESS_USER_NOT_FOUND');
  return user;
}

async function listAssignableRegisters(tenantId, client = prisma) {
  const safeTenantId = cleanId(tenantId);
  if (!safeTenantId) return [];
  return client.cajaBanco.findMany({
    where: { tenantId: safeTenantId, tipo: 'CAJA', activo: true },
    select: { id: true, nombre: true, saldoActual: true },
    orderBy: [{ nombre: 'asc' }]
  });
}

async function listCommerceAccessOverview(tenantId, client = prisma) {
  const safeTenantId = cleanId(tenantId);
  if (!safeTenantId) throw new AppError(400, 'tenantId es obligatorio', 'COMMERCE_ACCESS_TENANT_REQUIRED');

  await rbac.ensureTenantRoles(safeTenantId, client);

  const [users, roles, permissions, scopeRows, registers] = await Promise.all([
    client.user.findMany({
      where: { tenantId: safeTenantId, activo: true },
      select: { id: true, nombre: true, email: true, rol: true, activo: true },
      orderBy: [{ nombre: 'asc' }]
    }),
    client.rbacRole.findMany({
      where: { tenantId: safeTenantId, active: true },
      select: { id: true, code: true, name: true, description: true, vertical: true, system: true },
      orderBy: [{ system: 'desc' }, { name: 'asc' }]
    }),
    client.rbacPermission.findMany({
      where: { module: { in: [...COMMERCE_MODULES] } },
      select: { id: true, code: true, module: true, action: true, description: true },
      orderBy: [{ module: 'asc' }, { action: 'asc' }]
    }),
    client.rbacScopeGrant.findMany({
      where: { tenantId: safeTenantId, active: true },
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        permissionCode: true,
        scopeType: true,
        resourceId: true,
        reason: true,
        grantedByUserId: true,
        creadoEn: true
      },
      orderBy: [{ creadoEn: 'asc' }]
    }),
    listAssignableRegisters(safeTenantId, client)
  ]);

  return {
    tenantId: safeTenantId,
    modules: [...COMMERCE_MODULES],
    scopeTypes: Object.values(SCOPE_TYPES),
    users,
    roles,
    permissions,
    scopeGrants: scopeRows,
    registers
  };
}

async function getUserAccessProfile(tenantId, userId, client = prisma) {
  const user = await requireTenantUser(tenantId, userId, client);
  await rbac.ensureTenantRoles(user.tenantId, client);

  const assignments = await client.rbacUserRole.findMany({
    where: { tenantId: user.tenantId, userId: user.id },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } }
        }
      }
    }
  });

  let roleAssignments = assignments.filter((assignment) => assignment.role?.active);
  if (!roleAssignments.length && user.rol) {
    const legacyRole = await client.rbacRole.findFirst({
      where: { tenantId: user.tenantId, code: String(user.rol).toUpperCase(), active: true },
      include: { permissions: { include: { permission: true } } }
    });
    if (legacyRole) roleAssignments = [{ roleId: legacyRole.id, role: legacyRole }];
  }

  const roleIds = unique(roleAssignments.map((assignment) => assignment.roleId || assignment.role?.id));
  const [overrides, userScopes, roleScopes] = await Promise.all([
    client.rbacUserPermissionOverride.findMany({
      where: { tenantId: user.tenantId, userId: user.id },
      include: { permission: true },
      orderBy: [{ creadoEn: 'asc' }]
    }),
    client.rbacScopeGrant.findMany({
      where: {
        tenantId: user.tenantId,
        subjectType: 'USER',
        subjectId: user.id,
        active: true
      },
      orderBy: [{ creadoEn: 'asc' }]
    }),
    roleIds.length
      ? client.rbacScopeGrant.findMany({
          where: {
            tenantId: user.tenantId,
            subjectType: 'ROLE',
            subjectId: { in: roleIds },
            active: true
          },
          orderBy: [{ creadoEn: 'asc' }]
        })
      : Promise.resolve([])
  ]);

  const effectivePermissions = [...await rbac.effectivePermissions(user.tenantId, user)].sort();
  const userScopesByPermission = groupScopeRows(userScopes);
  const roleScopesByPermission = groupScopeRows(roleScopes);
  const effectiveScopes = {};
  const permissionUniverse = unique([
    ...effectivePermissions.filter((code) => code !== '*'),
    ...Object.keys(userScopesByPermission),
    ...Object.keys(roleScopesByPermission)
  ]).sort();

  for (const permissionCode of permissionUniverse) {
    effectiveScopes[permissionCode] = userScopesByPermission[permissionCode]?.length
      ? userScopesByPermission[permissionCode]
      : (roleScopesByPermission[permissionCode] || []);
  }

  return {
    user,
    roles: roleAssignments.map((assignment) => ({
      id: assignment.role.id,
      code: assignment.role.code,
      name: assignment.role.name,
      system: assignment.role.system,
      vertical: assignment.role.vertical,
      permissions: (assignment.role.permissions || []).map((rp) => rp.permission.code).sort()
    })),
    overrides: overrides.map((override) => ({
      permissionCode: override.permission.code,
      effect: override.effect,
      reason: override.reason || null
    })),
    directScopeGrants: userScopes.map((row) => ({
      id: row.id,
      permissionCode: row.permissionCode,
      type: row.scopeType,
      resourceId: row.resourceId || null,
      reason: row.reason || null
    })),
    inheritedScopeGrants: roleScopes.map((row) => ({
      id: row.id,
      subjectId: row.subjectId,
      permissionCode: row.permissionCode,
      type: row.scopeType,
      resourceId: row.resourceId || null,
      reason: row.reason || null
    })),
    effectivePermissions,
    effectiveScopes
  };
}

async function assignScope(input, client = prisma) {
  return persistentScopes.setScopeGrant(input, client);
}

async function disableScope(input, client = prisma) {
  return persistentScopes.disableScopeGrant(input, client);
}

module.exports = {
  COMMERCE_MODULES,
  listAssignableRegisters,
  listCommerceAccessOverview,
  getUserAccessProfile,
  assignScope,
  disableScope
};
