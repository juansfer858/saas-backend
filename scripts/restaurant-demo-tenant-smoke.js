const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');

async function main() {
  installRestaurantRbac();
  const seeded = await ensureRestaurantDemoTenant();
  assert.equal(seeded.subdomain, SUBDOMAIN);

  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant);
  assert.equal(tenant.nicho, 'RESTAURANTE');

  const config = await prisma.restaurantConfig.findUnique({ where: { tenantId: tenant.id } });
  assert.ok(config);
  assert.equal(config.verticalStatus, 'FUNCTIONAL_SIMULATED_PRINT');
  assert.equal(config.printMode, 'SIMULATED_SCREEN');
  assert.equal(config.physicalPrinterFieldPass, false);
  assert.equal(config.metaBusinessManagementReviewPass, false);
  assert.equal(config.dianRealEnabled, false);

  const [tables, menuItems, recipes, users] = await Promise.all([
    prisma.restaurantTable.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.restaurantMenuItem.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.consumptionRecipe.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.user.findMany({ where: { tenantId: tenant.id, activo: true } })
  ]);
  assert.equal(tables, 6);
  assert.equal(menuItems, 4);
  assert.equal(recipes, 4);

  const byRole = new Map(users.map((x) => [x.rol, x]));
  for (const role of ['ADMIN', 'MESERO', 'COCINA', 'BARRA', 'POSTRES', 'CAJERO']) assert.ok(byRole.get(role), `Missing ${role}`);

  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('ADMIN'), 'RESTAURANTE.ADMINISTRAR'), true);
  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('MESERO'), 'PEDIDOS.CREAR'), true);
  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('MESERO'), 'CONTABILIDAD.VER'), false);
  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('COCINA'), 'COMANDAS.EDITAR'), true);
  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('COCINA'), 'TESORERIA.VER'), false);
  assert.equal(await rbac.hasPermission(tenant.id, byRole.get('CAJERO'), 'RESTAURANTE.CERRAR'), true);

  const adminRole = await prisma.rbacRole.findFirst({
    where: { tenantId: tenant.id, code: 'ADMIN' },
    include: { permissions: { include: { permission: true } } }
  });
  const adminCodes = new Set(adminRole.permissions.map((x) => x.permission.code));
  assert.ok(adminCodes.has('RESTAURANTE.ADMINISTRAR'));
  assert.ok(adminCodes.has('MESAS.VER'));
  assert.ok(adminCodes.has('COMANDAS.EDITAR'));

  console.log('RESTAURANT DEDICATED DEMO TENANT SMOKE OK');
  console.log(JSON.stringify({
    subdomain: tenant.subdomain,
    tenantId: tenant.id,
    tables,
    menuItems,
    recipes,
    roles: ['ADMIN', 'MESERO', 'COCINA', 'BARRA', 'POSTRES', 'CAJERO'],
    status: 'FUNCTIONAL_SIMULATED_PRINT',
    productionReadyClaimed: false
  }, null, 2));
}

main().catch((error) => {
  console.error('RESTAURANT DEDICATED DEMO TENANT SMOKE FAILED');
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
