const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const { installRestaurantRbac } = require('../src/modules/restaurant/restaurant.rbac');

const PASSWORD_HASH = '$2y$12$D8g5.rrzj2zyeDch7EfaSeZGiuY3v/le.rF97fN5vT9j.QkbG7LKa';
const SUBDOMAIN = 'demo-restaurante';

const USERS = [
  ['ADMIN', 'Administrador Restaurante', 'admin@demo-restaurante.vantixgc.com'],
  ['MESERO', 'Mesero Restaurante', 'mesero@demo-restaurante.vantixgc.com'],
  ['COCINA', 'Cocina Restaurante', 'cocina@demo-restaurante.vantixgc.com'],
  ['BARRA', 'Barra Restaurante', 'barra@demo-restaurante.vantixgc.com'],
  ['POSTRES', 'Postres Restaurante', 'postres@demo-restaurante.vantixgc.com'],
  ['CAJERO', 'Cajero Restaurante', 'cajero@demo-restaurante.vantixgc.com']
];

const PRODUCTS = [
  { sku: 'ING-PAN', nombre: 'Pan hamburguesa', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 1200, stockActual: 100, precio1: 0 },
  { sku: 'ING-CARNE', nombre: 'Carne hamburguesa', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 4500, stockActual: 100, precio1: 0 },
  { sku: 'ING-PAPA', nombre: 'Papa porción', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 1800, stockActual: 100, precio1: 0 },
  { sku: 'ING-LIMON', nombre: 'Limón', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 500, stockActual: 200, precio1: 0 },
  { sku: 'ING-AZUCAR', nombre: 'Azúcar porción', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 250, stockActual: 200, precio1: 0 },
  { sku: 'ING-POSTRE', nombre: 'Base postre', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 2500, stockActual: 80, precio1: 0 },
  { sku: 'REST-PAPAS', nombre: 'Papas de entrada', unidadMedida: 'UND', controlaInventario: false, costoPromedio: 0, stockActual: 0, precio1: 9000, impoconsumoPct: 8 },
  { sku: 'REST-HAMB', nombre: 'Hamburguesa VantixGC', unidadMedida: 'UND', controlaInventario: false, costoPromedio: 0, stockActual: 0, precio1: 22000, impoconsumoPct: 8 },
  { sku: 'REST-LIMONADA', nombre: 'Limonada natural', unidadMedida: 'UND', controlaInventario: false, costoPromedio: 0, stockActual: 0, precio1: 7000, impoconsumoPct: 8 },
  { sku: 'REST-POSTRE', nombre: 'Postre de la casa', unidadMedida: 'UND', controlaInventario: false, costoPromedio: 0, stockActual: 0, precio1: 10000, impoconsumoPct: 8 }
];

async function seedRecipe(tx, tenantId, productBySku, code, outputSku, items) {
  const output = productBySku.get(outputSku);
  const recipe = await tx.consumptionRecipe.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: { tenantId, code, name: `Receta ${output.nombre}`, outputProductId: output.id, active: true },
    update: { name: `Receta ${output.nombre}`, outputProductId: output.id, active: true }
  });
  await tx.consumptionRecipeItem.deleteMany({ where: { recipeId: recipe.id } });
  await tx.consumptionRecipeItem.createMany({
    data: items.map(([sku, quantity]) => ({ tenantId, recipeId: recipe.id, ingredientProductId: productBySku.get(sku).id, quantity, unitLabel: 'UND' }))
  });
  return recipe;
}

async function ensureRestaurantDemoTenant() {
  installRestaurantRbac();
  return prisma.$transaction(async (tx) => {
    let tenant = await tx.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
    if (!tenant) {
      tenant = await tx.tenant.create({ data: { nombreEmpresa: 'VantixGC Restaurante Demo', subdomain: SUBDOMAIN, nicho: 'RESTAURANTE', pais: 'CO', moneda: 'COP', activo: true } });
    } else {
      tenant = await tx.tenant.update({ where: { id: tenant.id }, data: { nombreEmpresa: 'VantixGC Restaurante Demo', nicho: 'RESTAURANTE', activo: true } });
    }

    await seedTenantDefaults(tx, tenant);

    const users = {};
    for (const [role, name, email] of USERS) {
      users[role] = await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        create: { tenantId: tenant.id, nombre: name, email, password: PASSWORD_HASH, rol: role, activo: true },
        update: { nombre: name, rol: role, activo: true }
      });
    }

    await seedPlatformDefaults(tx, tenant, users.ADMIN);
    const roles = await rbac.ensureTenantRoles(tenant.id, tx);
    for (const role of ['MESERO', 'COCINA', 'BARRA', 'POSTRES', 'CAJERO']) {
      await tx.rbacUserRole.upsert({
        where: { tenantId_userId_roleId: { tenantId: tenant.id, userId: users[role].id, roleId: roles[role].id } },
        create: { tenantId: tenant.id, userId: users[role].id, roleId: roles[role].id },
        update: {}
      });
    }

    const productBySku = new Map();
    for (const item of PRODUCTS) {
      const product = await tx.producto.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: item.sku } },
        create: { tenantId: tenant.id, tipo: 'PRODUCTO', activo: true, ivaPct: 0, ...item },
        update: { nombre: item.nombre, unidadMedida: item.unidadMedida, controlaInventario: item.controlaInventario, costoPromedio: item.costoPromedio, precio1: item.precio1, ivaPct: 0, impoconsumoPct: item.impoconsumoPct || 0, activo: true }
      });
      productBySku.set(item.sku, product);
    }

    await seedRecipe(tx, tenant.id, productBySku, 'REST-R-PAPAS', 'REST-PAPAS', [['ING-PAPA', 1]]);
    await seedRecipe(tx, tenant.id, productBySku, 'REST-R-HAMB', 'REST-HAMB', [['ING-PAN', 1], ['ING-CARNE', 1], ['ING-PAPA', 0.5]]);
    await seedRecipe(tx, tenant.id, productBySku, 'REST-R-LIMONADA', 'REST-LIMONADA', [['ING-LIMON', 2], ['ING-AZUCAR', 1]]);
    await seedRecipe(tx, tenant.id, productBySku, 'REST-R-POSTRE', 'REST-POSTRE', [['ING-POSTRE', 1]]);

    const menu = [
      ['REST-PAPAS', 'ENTRADAS', 'COCINA', 10],
      ['REST-HAMB', 'FUERTES', 'COCINA', 20],
      ['REST-LIMONADA', 'BEBIDAS', 'BARRA', 30],
      ['REST-POSTRE', 'POSTRES', 'POSTRES', 40]
    ];
    for (const [sku, category, station, sortOrder] of menu) {
      await tx.restaurantMenuItem.upsert({
        where: { tenantId_productId: { tenantId: tenant.id, productId: productBySku.get(sku).id } },
        create: { tenantId: tenant.id, productId: productBySku.get(sku).id, category, station, requiresRecipe: true, active: true, sortOrder },
        update: { category, station, requiresRecipe: true, active: true, sortOrder }
      });
    }

    for (let i = 1; i <= 6; i += 1) {
      await tx.restaurantTable.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: `M${i}` } },
        create: { tenantId: tenant.id, code: `M${i}`, name: `Mesa ${i}`, seats: 4, posX: 30 + ((i - 1) % 3) * 170, posY: 35 + Math.floor((i - 1) / 3) * 130, assignedWaiterId: users.MESERO.id },
        update: { name: `Mesa ${i}`, active: true, assignedWaiterId: users.MESERO.id }
      });
    }

    await tx.restaurantConfig.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, verticalStatus: 'FUNCTIONAL_SIMULATED_PRINT', printMode: 'SIMULATED_SCREEN', physicalPrinterFieldPass: false, metaBusinessManagementReviewPass: false, dianRealEnabled: false, simulatedFiscalOperationExplicitlyAccepted: false, allowSimulatedDocumentEquivalent: true, whatsappOrderReadyEnabled: false },
      update: { verticalStatus: 'FUNCTIONAL_SIMULATED_PRINT', printMode: 'SIMULATED_SCREEN', allowSimulatedDocumentEquivalent: true }
    });

    return { tenantId: tenant.id, subdomain: tenant.subdomain, users: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, user.id])), products: productBySku.size, menuItems: menu.length, tables: 6 };
  });
}

async function main() {
  const result = await ensureRestaurantDemoTenant();
  console.log('RESTAURANT DEMO TENANT READY', JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => { console.error('RESTAURANT DEMO TENANT ERROR', error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
}

module.exports = { SUBDOMAIN, ensureRestaurantDemoTenant };
