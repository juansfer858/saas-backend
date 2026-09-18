'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const scopes = require('../src/modules/platform/rbac/persistent-scope.service');
const shell = require('../src/modules/platform/modules/dynamic-shell.service');

async function createRoleWithPermissions(tenantId, adminId, code, name, permissions) {
  const role = await prisma.rbacRole.create({
    data: { tenantId, code, name, vertical: 'COMERCIO', active: true }
  });
  await rbac.setRolePermissions(tenantId, adminId, role.id, permissions);
  return role;
}

async function assignRoleScopes(tenantId, adminId, roleId, entries) {
  for (const entry of entries) {
    await scopes.setScopeGrant({
      tenantId,
      actorUserId: adminId,
      subjectType: 'ROLE',
      subjectId: roleId,
      permissionCode: entry.permissionCode,
      grant: { type: entry.type, resourceId: entry.resourceId || null },
      reason: 'Dynamic Shell V1 lab'
    });
  }
}

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: 'Dynamic Shell Commerce Lab',
      subdomain: `dynamic-shell-${stamp}`,
      nicho: 'SUPERMERCADO'
    }
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Administrador',
      email: `admin-shell-${stamp}@example.com`,
      password: 'hash-lab',
      rol: 'ADMIN'
    }
  });
  const cashier = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Laura Cajera',
      email: `cashier-shell-${stamp}@example.com`,
      password: 'hash-lab',
      rol: 'CAJERO_SHELL'
    }
  });
  const storekeeper = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Mario Bodega',
      email: `warehouse-shell-${stamp}@example.com`,
      password: 'hash-lab',
      rol: 'BODEGA_SHELL'
    }
  });
  const accountant = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Ana Contabilidad',
      email: `accountant-shell-${stamp}@example.com`,
      password: 'hash-lab',
      rol: 'CONTADOR_SHELL'
    }
  });

  await rbac.ensurePermissions();

  const cashierRole = await createRoleWithPermissions(tenant.id, admin.id, 'CAJERO_SHELL', 'Cajero', [
    'DASHBOARD.VER', 'VENTAS.VER', 'INVENTARIO.VER'
  ]);
  const storekeeperRole = await createRoleWithPermissions(tenant.id, admin.id, 'BODEGA_SHELL', 'Bodega', [
    'DASHBOARD.VER', 'COMPRAS.VER', 'INVENTARIO.VER'
  ]);
  const accountantRole = await createRoleWithPermissions(tenant.id, admin.id, 'CONTADOR_SHELL', 'Contador', [
    'DASHBOARD.VER', 'TESORERIA.VER', 'CARTERA.VER', 'CONTABILIDAD.VER', 'REPORTES.VER', 'DIAN.VER'
  ]);

  await rbac.setUserRoles(tenant.id, admin.id, cashier.id, [cashierRole.id]);
  await rbac.setUserRoles(tenant.id, admin.id, storekeeper.id, [storekeeperRole.id]);
  await rbac.setUserRoles(tenant.id, admin.id, accountant.id, [accountantRole.id]);

  await assignRoleScopes(tenant.id, admin.id, cashierRole.id, [
    { permissionCode: 'VENTAS.VER', type: 'ASSIGNED_REGISTER' }
  ]);
  await assignRoleScopes(tenant.id, admin.id, storekeeperRole.id, [
    { permissionCode: 'COMPRAS.VER', type: 'TENANT' },
    { permissionCode: 'INVENTARIO.VER', type: 'TENANT' }
  ]);
  await assignRoleScopes(tenant.id, admin.id, accountantRole.id, [
    { permissionCode: 'TESORERIA.VER', type: 'TENANT' },
    { permissionCode: 'CARTERA.VER', type: 'TENANT' },
    { permissionCode: 'CONTABILIDAD.VER', type: 'TENANT' },
    { permissionCode: 'REPORTES.VER', type: 'TENANT' },
    { permissionCode: 'DIAN.VER', type: 'TENANT' }
  ]);

  const cashierShell = await shell.resolveDynamicShell({
    tenantId: tenant.id,
    user: cashier,
    shell: 'OPERATION',
    device: 'POS'
  });
  assert.deepEqual(cashierShell.modules.map((m) => m.code), ['DASHBOARD', 'VENTAS', 'INVENTARIO']);
  assert.equal(cashierShell.landingPath, '/app/dashboard');
  const cashierSales = cashierShell.modules.find((m) => m.code === 'VENTAS');
  assert.equal(cashierSales.scopeProfile[0].permissionCode, 'VENTAS.VER');
  assert.deepEqual(cashierSales.scopeProfile[0].grants, [{ type: 'ASSIGNED_REGISTER', resourceId: null }]);

  const storekeeperShell = await shell.resolveDynamicShell({
    tenantId: tenant.id,
    user: storekeeper,
    shell: 'OPERATION',
    device: 'TABLET'
  });
  assert.deepEqual(storekeeperShell.modules.map((m) => m.code), ['DASHBOARD', 'COMPRAS', 'INVENTARIO']);
  assert.deepEqual(storekeeperShell.groups.map((g) => g.code), ['GENERAL', 'OPERACION']);

  const accountantShell = await shell.resolveDynamicShell({
    tenantId: tenant.id,
    user: accountant,
    shell: 'FISCAL',
    device: 'DESKTOP'
  });
  assert.deepEqual(accountantShell.modules.map((m) => m.code), [
    'DASHBOARD', 'TESORERIA', 'CARTERA', 'CONTABILIDAD', 'REPORTES', 'DIAN'
  ]);
  assert.equal(accountantShell.modules.find((m) => m.code === 'CONTABILIDAD').hasScopedGrant, true);

  const adminShell = await shell.resolveDynamicShell({
    tenantId: tenant.id,
    user: admin,
    shell: 'FULL',
    device: 'DESKTOP'
  });
  assert.deepEqual(adminShell.modules.map((m) => m.code), [
    'DASHBOARD', 'VENTAS', 'COMPRAS', 'INVENTARIO', 'TERCEROS', 'TESORERIA',
    'CARTERA', 'CONTABILIDAD', 'REPORTES', 'DIAN', 'CONFIGURACION'
  ]);
  assert.equal(adminShell.modules.find((m) => m.code === 'VENTAS').scopeProfile[0].grants[0].type, 'TENANT');

  console.log('COMMERCE_DYNAMIC_SHELL_POSTGRES_OK', JSON.stringify({
    tenantId: tenant.id,
    cashier: cashierShell.modules.map((m) => m.code),
    storekeeper: storekeeperShell.modules.map((m) => m.code),
    accountant: accountantShell.modules.map((m) => m.code),
    admin: adminShell.modules.map((m) => m.code)
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
