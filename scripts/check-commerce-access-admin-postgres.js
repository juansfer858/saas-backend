'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const persistentScopes = require('../src/modules/platform/rbac/persistent-scope.service');
const accessAdmin = require('../src/modules/platform/rbac/commerce-access-admin.service');

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: 'Supermercado Scope Lab',
      subdomain: `commerce-access-${Date.now()}`,
      nicho: 'SUPERMERCADO'
    }
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Admin Comercio',
      email: `admin-${Date.now()}@example.com`,
      password: 'hash-lab',
      rol: 'ADMIN'
    }
  });

  const cashier = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Laura Caja 01',
      email: `laura-${Date.now()}@example.com`,
      password: 'hash-lab',
      rol: 'CAJERO_COMERCIO'
    }
  });

  await rbac.ensurePermissions();

  const cashierRole = await prisma.rbacRole.create({
    data: {
      tenantId: tenant.id,
      code: 'CAJERO_COMERCIO',
      name: 'Cajero Comercio',
      vertical: 'COMERCIO',
      system: false,
      active: true
    }
  });

  await rbac.setRolePermissions(tenant.id, admin.id, cashierRole.id, ['VENTAS.VER']);
  await rbac.setUserRoles(tenant.id, admin.id, cashier.id, [cashierRole.id]);

  const caja01 = await prisma.cajaBanco.create({
    data: { tenantId: tenant.id, tipo: 'CAJA', nombre: 'Caja 01', saldoActual: 0 }
  });
  const caja02 = await prisma.cajaBanco.create({
    data: { tenantId: tenant.id, tipo: 'CAJA', nombre: 'Caja 02', saldoActual: 0 }
  });

  await prisma.aperturaCierreCaja.create({
    data: {
      tenantId: tenant.id,
      cajaBancoId: caja01.id,
      userId: cashier.id,
      estado: 'ABIERTA',
      saldoInicial: 100000,
      saldoEsperado: 100000
    }
  });

  const roleGrant = await persistentScopes.setScopeGrant({
    tenantId: tenant.id,
    actorUserId: admin.id,
    subjectType: 'ROLE',
    subjectId: cashierRole.id,
    permissionCode: 'VENTAS.VER',
    grant: { type: 'ASSIGNED_REGISTER' },
    reason: 'Cajero sólo puede operar su caja abierta'
  });

  const overview = await accessAdmin.listCommerceAccessOverview(tenant.id);
  assert.equal(overview.tenantId, tenant.id);
  assert.ok(overview.modules.includes('VENTAS'));
  assert.ok(overview.scopeTypes.includes('ASSIGNED_REGISTER'));
  assert.equal(overview.users.some((user) => user.id === cashier.id), true);
  assert.equal(overview.roles.some((role) => role.id === cashierRole.id), true);
  assert.deepEqual(overview.registers.map((register) => register.nombre).sort(), ['Caja 01', 'Caja 02']);
  assert.equal(overview.scopeGrants.some((grant) => grant.id === roleGrant.id), true);

  const inherited = await accessAdmin.getUserAccessProfile(tenant.id, cashier.id);
  assert.equal(inherited.user.id, cashier.id);
  assert.ok(inherited.effectivePermissions.includes('VENTAS.VER'));
  assert.deepEqual(inherited.effectiveScopes['VENTAS.VER'], [
    { type: 'ASSIGNED_REGISTER', resourceId: null }
  ]);

  const denyGrant = await accessAdmin.assignScope({
    tenantId: tenant.id,
    actorUserId: admin.id,
    subjectType: 'USER',
    subjectId: cashier.id,
    permissionCode: 'VENTAS.VER',
    grant: { type: 'NONE' },
    reason: 'Bloqueo temporal de laboratorio'
  });

  const blocked = await accessAdmin.getUserAccessProfile(tenant.id, cashier.id);
  assert.deepEqual(blocked.effectiveScopes['VENTAS.VER'], [
    { type: 'NONE', resourceId: null }
  ]);

  await accessAdmin.disableScope({
    tenantId: tenant.id,
    actorUserId: admin.id,
    grantId: denyGrant.id,
    reason: 'Restaurar herencia del rol'
  });

  const restored = await accessAdmin.getUserAccessProfile(tenant.id, cashier.id);
  assert.deepEqual(restored.effectiveScopes['VENTAS.VER'], [
    { type: 'ASSIGNED_REGISTER', resourceId: null }
  ]);

  const assignedRegisters = await accessAdmin.listAssignableRegisters(tenant.id);
  assert.equal(assignedRegisters.some((register) => register.id === caja01.id), true);
  assert.equal(assignedRegisters.some((register) => register.id === caja02.id), true);

  console.log('COMMERCE_ACCESS_ADMIN_POSTGRES_OK', JSON.stringify({
    tenantId: tenant.id,
    cashierId: cashier.id,
    roleId: cashierRole.id,
    registers: assignedRegisters.map((register) => register.nombre),
    effectiveScope: restored.effectiveScopes['VENTAS.VER']
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
