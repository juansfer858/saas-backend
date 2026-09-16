'use strict';

const assert = require('assert/strict');
const { prisma } = require('../src/config/prisma');
const { authorizeScopedAction } = require('../src/modules/platform/rbac/scope-policy.service');
const { hydrateAssignedRegisterScopeContext } = require('../src/modules/platform/rbac/commerce-scope-resolver.service');
const {
  setScopeGrant,
  disableScopeGrant,
  effectiveScopeGrants
} = require('../src/modules/platform/rbac/persistent-scope.service');

async function createTenant(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return prisma.tenant.create({
    data: {
      nombreEmpresa: `Commerce Scope ${label}`,
      subdomain: `scope-${label.toLowerCase()}-${suffix}`,
      nicho: 'COMERCIO'
    }
  });
}

async function createUser(tenantId, label, rol) {
  return prisma.user.create({
    data: {
      tenantId,
      nombre: label,
      email: `${label.toLowerCase().replace(/\s+/g, '.')}+${Date.now()}-${Math.random().toString(16).slice(2, 6)}@scope.test`,
      password: 'not-used-in-scope-ci',
      rol,
      activo: true
    }
  });
}

async function createCashRegister(tenantId, name) {
  return prisma.cajaBanco.create({
    data: {
      tenantId,
      tipo: 'CAJA',
      nombre: name,
      saldoActual: 0,
      activo: true
    }
  });
}

async function ensurePermissionAndRole(tenantId, code = 'CAJERO_SCOPE_TEST') {
  const permission = await prisma.rbacPermission.upsert({
    where: { code: 'VENTAS.VER' },
    create: { code: 'VENTAS.VER', module: 'VENTAS', action: 'VER', description: 'Ver ventas' },
    update: { module: 'VENTAS', action: 'VER' }
  });

  const role = await prisma.rbacRole.create({
    data: {
      tenantId,
      code: `${code}_${Math.random().toString(16).slice(2, 7)}`,
      name: 'Cajero Scope Test',
      vertical: 'COMERCIO',
      system: false,
      active: true
    }
  });

  await prisma.rbacRolePermission.create({
    data: { roleId: role.id, permissionId: permission.id }
  });

  return { permission, role };
}

async function assignRole(tenantId, userId, roleId) {
  await prisma.rbacUserRole.create({ data: { tenantId, userId, roleId } });
}

async function openShift(tenantId, userId, cajaBancoId, saldoInicial = 100000) {
  return prisma.aperturaCierreCaja.create({
    data: {
      tenantId,
      userId,
      cajaBancoId,
      estado: 'ABIERTA',
      saldoInicial,
      saldoEsperado: saldoInicial
    }
  });
}

async function authorizeRegister({ tenantId, user, registerId, resourceTenantId = tenantId }) {
  const grants = await effectiveScopeGrants(tenantId, user, 'VENTAS.VER');
  const context = await hydrateAssignedRegisterScopeContext({
    tenantId,
    userId: user.id,
    resourceTenantId,
    registerId
  });
  return {
    grants,
    context,
    allowed: authorizeScopedAction({ permissionAllowed: true, grants, context })
  };
}

async function main() {
  const tenantA = await createTenant('A');
  const tenantB = await createTenant('B');

  const adminA = await createUser(tenantA.id, 'Admin A', 'ADMIN');
  const cashierA = await createUser(tenantA.id, 'Cashier A', 'VENDEDOR');
  const cashierB = await createUser(tenantA.id, 'Cashier B', 'VENDEDOR');

  const cajaA1 = await createCashRegister(tenantA.id, `Caja A1 ${Date.now()}`);
  const cajaA2 = await createCashRegister(tenantA.id, `Caja A2 ${Date.now()}`);
  const cajaB1 = await createCashRegister(tenantB.id, `Caja B1 ${Date.now()}`);

  const { role } = await ensurePermissionAndRole(tenantA.id);
  await assignRole(tenantA.id, cashierA.id, role.id);
  await assignRole(tenantA.id, cashierB.id, role.id);

  await openShift(tenantA.id, cashierA.id, cajaA1.id);
  await openShift(tenantA.id, cashierB.id, cajaA2.id);

  await setScopeGrant({
    tenantId: tenantA.id,
    actorUserId: adminA.id,
    subjectType: 'ROLE',
    subjectId: role.id,
    permissionCode: 'VENTAS.VER',
    grant: { type: 'ASSIGNED_REGISTER' },
    reason: 'Commerce persistent scope CI'
  });

  const ownA = await authorizeRegister({ tenantId: tenantA.id, user: cashierA, registerId: cajaA1.id });
  assert.equal(ownA.allowed, true, 'Cashier A debe acceder a Caja A1');
  assert.deepEqual(ownA.grants, [{ type: 'ASSIGNED_REGISTER', resourceId: null }]);
  assert.deepEqual(ownA.context.assignedRegisterIds, [cajaA1.id]);

  const otherA = await authorizeRegister({ tenantId: tenantA.id, user: cashierA, registerId: cajaA2.id });
  assert.equal(otherA.allowed, false, 'Cashier A no debe acceder a Caja A2');

  const ownB = await authorizeRegister({ tenantId: tenantA.id, user: cashierB, registerId: cajaA2.id });
  assert.equal(ownB.allowed, true, 'Cashier B debe acceder a Caja A2');

  const otherB = await authorizeRegister({ tenantId: tenantA.id, user: cashierB, registerId: cajaA1.id });
  assert.equal(otherB.allowed, false, 'Cashier B no debe acceder a Caja A1');

  const crossTenant = await authorizeRegister({
    tenantId: tenantA.id,
    user: cashierA,
    registerId: cajaB1.id,
    resourceTenantId: tenantB.id
  });
  assert.equal(crossTenant.allowed, false, 'Nunca debe cruzar tenants');

  const userDeny = await setScopeGrant({
    tenantId: tenantA.id,
    actorUserId: adminA.id,
    subjectType: 'USER',
    subjectId: cashierA.id,
    permissionCode: 'VENTAS.VER',
    grant: { type: 'NONE' },
    reason: 'Validar precedencia de scope de usuario'
  });

  const narrowed = await authorizeRegister({ tenantId: tenantA.id, user: cashierA, registerId: cajaA1.id });
  assert.equal(narrowed.allowed, false, 'Scope USER NONE debe reemplazar scope heredado del rol');
  assert.deepEqual(narrowed.grants, [{ type: 'NONE', resourceId: null }]);

  await disableScopeGrant({
    tenantId: tenantA.id,
    actorUserId: adminA.id,
    grantId: userDeny.id,
    reason: 'Restaurar herencia del rol'
  });

  const restored = await authorizeRegister({ tenantId: tenantA.id, user: cashierA, registerId: cajaA1.id });
  assert.equal(restored.allowed, true, 'Al desactivar override vuelve el scope del rol');

  const grantsInDb = await prisma.rbacScopeGrant.findMany({
    where: { tenantId: tenantA.id, permissionCode: 'VENTAS.VER' },
    orderBy: { creadoEn: 'asc' }
  });
  assert.equal(grantsInDb.length, 2, 'Debe persistir grant de rol y grant de usuario desactivado');
  assert.equal(grantsInDb.filter((x) => x.active).length, 1, 'Sólo el grant de rol debe quedar activo');

  const audits = await prisma.rbacAudit.findMany({
    where: { tenantId: tenantA.id, action: { in: ['SCOPE_GRANT_SET', 'SCOPE_GRANT_DISABLE'] } }
  });
  assert.ok(audits.length >= 3, 'Cambios de scope deben quedar auditados');

  console.log('COMMERCE_PERSISTENT_SCOPE_POSTGRES_OK', JSON.stringify({
    tenantA: tenantA.id,
    cajaA1: cajaA1.id,
    cajaA2: cajaA2.id,
    cajaB1: cajaB1.id,
    activeScopeGrants: grantsInDb.filter((x) => x.active).length,
    auditEvents: audits.length
  }));
}

main()
  .catch((error) => {
    console.error('COMMERCE_PERSISTENT_SCOPE_POSTGRES_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
