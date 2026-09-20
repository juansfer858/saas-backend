'use strict';

const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const { SCOPE_TYPES, normalizeScopeGrant } = require('./scope-policy.service');

const SUBJECT_TYPES = Object.freeze({
  ROLE: 'ROLE',
  USER: 'USER'
});

function clean(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
}

function normalizeSubjectType(value) {
  const type = clean(value)?.toUpperCase();
  if (!type || !Object.prototype.hasOwnProperty.call(SUBJECT_TYPES, type)) {
    throw new AppError(400, 'Tipo de sujeto de scope inválido', 'RBAC_SCOPE_SUBJECT_INVALID');
  }
  return type;
}

function normalizePermissionCode(value) {
  const code = clean(value)?.toUpperCase();
  if (!code) throw new AppError(400, 'permissionCode es obligatorio', 'RBAC_SCOPE_PERMISSION_REQUIRED');
  return code;
}

function normalizeGrantInput(input = {}) {
  const grant = normalizeScopeGrant({ type: input.type, resourceId: input.resourceId });
  if (!grant) throw new AppError(400, 'Scope inválido', 'RBAC_SCOPE_TYPE_INVALID');
  return {
    type: grant.type,
    resourceId: grant.resourceId,
    resourceKey: grant.resourceId || '*'
  };
}

async function ensurePermission(permissionCode, client = prisma) {
  const permission = await client.rbacPermission.findUnique({ where: { code: permissionCode } });
  if (!permission) throw new AppError(400, `Permiso no encontrado: ${permissionCode}`, 'RBAC_SCOPE_PERMISSION_INVALID');
  return permission;
}

async function ensureSubject(tenantId, subjectType, subjectId, client = prisma) {
  if (subjectType === SUBJECT_TYPES.USER) {
    const user = await client.user.findFirst({ where: { id: subjectId, tenantId, activo: true } });
    if (!user) throw new AppError(404, 'Usuario de scope no encontrado', 'RBAC_SCOPE_USER_NOT_FOUND');
    return user;
  }

  const role = await client.rbacRole.findFirst({ where: { id: subjectId, tenantId, active: true } });
  if (!role) throw new AppError(404, 'Rol de scope no encontrado', 'RBAC_SCOPE_ROLE_NOT_FOUND');
  return role;
}

async function auditScope(client, { tenantId, actorUserId, subjectType, subjectId, permissionCode, grant, action, reason }) {
  await client.rbacAudit.create({
    data: {
      tenantId,
      actorUserId,
      targetUserId: subjectType === SUBJECT_TYPES.USER ? subjectId : null,
      action,
      metadata: {
        subjectType,
        subjectId,
        permissionCode,
        scopeType: grant.type,
        resourceId: grant.resourceId || null,
        reason: reason || null
      }
    }
  });
}

async function setScopeGrant({ tenantId, actorUserId, subjectType, subjectId, permissionCode, grant, reason = null }, client = prisma) {
  const safeTenantId = clean(tenantId);
  const safeActorUserId = clean(actorUserId);
  const safeSubjectId = clean(subjectId);
  if (!safeTenantId || !safeActorUserId || !safeSubjectId) {
    throw new AppError(400, 'tenantId, actorUserId y subjectId son obligatorios', 'RBAC_SCOPE_INPUT_REQUIRED');
  }

  const safeSubjectType = normalizeSubjectType(subjectType);
  const safePermissionCode = normalizePermissionCode(permissionCode);
  const normalizedGrant = normalizeGrantInput(grant);

  await ensurePermission(safePermissionCode, client);
  await ensureSubject(safeTenantId, safeSubjectType, safeSubjectId, client);

  const row = await client.rbacScopeGrant.upsert({
    where: {
      tenantId_subjectType_subjectId_permissionCode_scopeType_resourceKey: {
        tenantId: safeTenantId,
        subjectType: safeSubjectType,
        subjectId: safeSubjectId,
        permissionCode: safePermissionCode,
        scopeType: normalizedGrant.type,
        resourceKey: normalizedGrant.resourceKey
      }
    },
    create: {
      tenantId: safeTenantId,
      subjectType: safeSubjectType,
      subjectId: safeSubjectId,
      permissionCode: safePermissionCode,
      scopeType: normalizedGrant.type,
      resourceId: normalizedGrant.resourceId,
      resourceKey: normalizedGrant.resourceKey,
      grantedByUserId: safeActorUserId,
      reason: reason || null,
      active: true
    },
    update: {
      resourceId: normalizedGrant.resourceId,
      grantedByUserId: safeActorUserId,
      reason: reason || null,
      active: true
    }
  });

  await auditScope(client, {
    tenantId: safeTenantId,
    actorUserId: safeActorUserId,
    subjectType: safeSubjectType,
    subjectId: safeSubjectId,
    permissionCode: safePermissionCode,
    grant: normalizedGrant,
    action: 'SCOPE_GRANT_SET',
    reason
  });

  return row;
}

async function disableScopeGrant({ tenantId, actorUserId, grantId, reason = null }, client = prisma) {
  const safeTenantId = clean(tenantId);
  const safeActorUserId = clean(actorUserId);
  const safeGrantId = clean(grantId);
  const row = await client.rbacScopeGrant.findFirst({ where: { id: safeGrantId, tenantId: safeTenantId } });
  if (!row) throw new AppError(404, 'Scope grant no encontrado', 'RBAC_SCOPE_GRANT_NOT_FOUND');

  const updated = await client.rbacScopeGrant.update({
    where: { id: row.id },
    data: { active: false, grantedByUserId: safeActorUserId, reason: reason || row.reason }
  });

  await auditScope(client, {
    tenantId: safeTenantId,
    actorUserId: safeActorUserId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    permissionCode: row.permissionCode,
    grant: { type: row.scopeType, resourceId: row.resourceId },
    action: 'SCOPE_GRANT_DISABLE',
    reason
  });

  return updated;
}

function dedupeGrantRows(rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows || []) {
    const grant = normalizeScopeGrant({ type: row.scopeType, resourceId: row.resourceId });
    if (!grant) continue;
    const key = `${grant.type}:${grant.resourceId || '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(grant);
  }
  return result;
}

async function effectiveScopeGrants(tenantId, user, permissionCode, client = prisma) {
  const safeTenantId = clean(tenantId);
  const safePermissionCode = normalizePermissionCode(permissionCode);
  if (!safeTenantId || !user?.id) return [];

  if (['ADMIN', 'SUPER_ADMIN'].includes(user.rol)) return [{ type: SCOPE_TYPES.TENANT, resourceId: null }];

  const userRows = await client.rbacScopeGrant.findMany({
    where: {
      tenantId: safeTenantId,
      subjectType: SUBJECT_TYPES.USER,
      subjectId: String(user.id),
      permissionCode: safePermissionCode,
      active: true
    },
    orderBy: [{ creadoEn: 'asc' }]
  });

  // Un scope explícito por usuario reemplaza los scopes heredados de roles para ese permiso.
  // Esto permite estrechar, por ejemplo, TENANT -> ASSIGNED_REGISTER sin tocar el rol compartido.
  if (userRows.length) return dedupeGrantRows(userRows);

  const assignments = await client.rbacUserRole.findMany({
    where: { tenantId: safeTenantId, userId: String(user.id) },
    include: { role: true }
  });

  let roleIds = assignments.filter((x) => x.role?.active).map((x) => x.roleId);
  if (!roleIds.length && user.rol) {
    const legacyRole = await client.rbacRole.findFirst({
      where: { tenantId: safeTenantId, code: String(user.rol).toUpperCase(), active: true },
      select: { id: true }
    });
    if (legacyRole) roleIds = [legacyRole.id];
  }

  if (!roleIds.length) return [];

  const roleRows = await client.rbacScopeGrant.findMany({
    where: {
      tenantId: safeTenantId,
      subjectType: SUBJECT_TYPES.ROLE,
      subjectId: { in: roleIds },
      permissionCode: safePermissionCode,
      active: true
    },
    orderBy: [{ creadoEn: 'asc' }]
  });

  return dedupeGrantRows(roleRows);
}

function buildPersistentGrantResolver({ client = prisma } = {}) {
  return async ({ actor, tenantId, permissionCode }) => effectiveScopeGrants(tenantId, actor, permissionCode, client);
}

module.exports = {
  SUBJECT_TYPES,
  normalizeSubjectType,
  normalizePermissionCode,
  normalizeGrantInput,
  setScopeGrant,
  disableScopeGrant,
  effectiveScopeGrants,
  buildPersistentGrantResolver
};
