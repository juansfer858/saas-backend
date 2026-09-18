'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const registry = require('../src/modules/platform/modules/module-registry.service');

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: 'Module Registry Lab',
      subdomain: `module-registry-${Date.now()}`,
      nicho: 'SUPERMERCADO'
    }
  });

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Admin Registry',
      email: `admin-registry-${Date.now()}@example.com`,
      password: 'hash-lab',
      rol: 'ADMIN'
    }
  });

  const cashier = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Cajero Registry',
      email: `cashier-registry-${Date.now()}@example.com`,
      password: 'hash-lab',
      rol: 'CAJERO_REGISTRY'
    }
  });

  await rbac.ensurePermissions();

  const cashierRole = await prisma.rbacRole.create({
    data: {
      tenantId: tenant.id,
      code: 'CAJERO_REGISTRY',
      name: 'Cajero Registry',
      vertical: 'COMERCIO',
      active: true
    }
  });

  await rbac.setRolePermissions(tenant.id, admin.id, cashierRole.id, [
    'DASHBOARD.VER',
    'VENTAS.VER',
    'INVENTARIO.VER'
  ]);
  await rbac.setUserRoles(tenant.id, admin.id, cashier.id, [cashierRole.id]);

  const initialStates = await registry.listTenantModuleStates(tenant.id);
  const ventasState = initialStates.find((module) => module.code === 'VENTAS');
  const inventoryState = initialStates.find((module) => module.code === 'INVENTARIO');
  assert.equal(ventasState.enabled, true);
  assert.equal(ventasState.persisted, false);
  assert.equal(inventoryState.enabled, true);

  const operationDesktop = await registry.resolveVisibleModules({
    tenantId: tenant.id,
    user: cashier,
    shell: 'OPERATION',
    device: 'DESKTOP'
  });
  assert.deepEqual(operationDesktop.map((module) => module.code), ['DASHBOARD', 'VENTAS', 'INVENTARIO']);

  const operationPos = await registry.resolveVisibleModules({
    tenantId: tenant.id,
    user: cashier,
    shell: 'OPERATION',
    device: 'POS'
  });
  assert.deepEqual(operationPos.map((module) => module.code), ['DASHBOARD', 'VENTAS', 'INVENTARIO']);

  const fiscalForCashier = await registry.resolveVisibleModules({
    tenantId: tenant.id,
    user: cashier,
    shell: 'FISCAL',
    device: 'DESKTOP'
  });
  assert.deepEqual(fiscalForCashier.map((module) => module.code), ['DASHBOARD']);

  await registry.setTenantModuleState({
    tenantId: tenant.id,
    actorUserId: admin.id,
    moduleCode: 'INVENTARIO',
    enabled: false,
    settings: { reason: 'Plan sin inventario temporal' }
  });

  const afterDisable = await registry.resolveVisibleModules({
    tenantId: tenant.id,
    user: cashier,
    shell: 'OPERATION',
    device: 'DESKTOP'
  });
  assert.deepEqual(afterDisable.map((module) => module.code), ['DASHBOARD', 'VENTAS']);

  await registry.setTenantModuleState({
    tenantId: tenant.id,
    actorUserId: admin.id,
    moduleCode: 'INVENTARIO',
    enabled: true,
    settings: null
  });

  const restored = await registry.resolveVisibleModules({
    tenantId: tenant.id,
    user: cashier,
    shell: 'TRANSITION',
    device: 'TABLET'
  });
  assert.deepEqual(restored.map((module) => module.code), ['DASHBOARD', 'VENTAS', 'INVENTARIO']);

  const audit = await prisma.rbacAudit.findMany({
    where: { tenantId: tenant.id, action: 'TENANT_MODULE_STATE_SET' },
    orderBy: { creadoEn: 'asc' }
  });
  assert.equal(audit.length, 2);
  assert.equal(audit[0].metadata.moduleCode, 'INVENTARIO');
  assert.equal(audit[0].metadata.enabled, false);
  assert.equal(audit[1].metadata.enabled, true);

  console.log('COMMERCE_MODULE_REGISTRY_POSTGRES_OK', JSON.stringify({
    tenantId: tenant.id,
    userId: cashier.id,
    operation: operationDesktop.map((module) => module.code),
    disabledInventory: afterDisable.map((module) => module.code),
    transition: restored.map((module) => module.code)
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
