'use strict';

const path = require('node:path');
const bcrypt = require('bcryptjs');

if (require.main === module) {
  require('dotenv').config({ path: process.env.P15_ENV_FILE || path.join(__dirname, '.env') });
}

const { assertConfig } = require('./runtime-config');
const LAB_USERS = Object.freeze([
  'admin@demo-restaurante.vantixgc.com',
  'mesero@demo-restaurante.vantixgc.com',
  'cocina@demo-restaurante.vantixgc.com',
  'barra@demo-restaurante.vantixgc.com',
  'postres@demo-restaurante.vantixgc.com',
  'cajero@demo-restaurante.vantixgc.com'
]);

async function bootstrap(env = process.env) {
  const config = assertConfig(env);
  const password = String(env.P15_ADMIN_PASSWORD || env.P15_LAB_SHARED_PASSWORD || '');
  if (password.length < 12) throw new Error('P15_ADMIN_PASSWORD debe tener al menos 12 caracteres para el bootstrap inicial.');
  process.env.JWT_SECRET = String(env.P15_JWT_SECRET || env.JWT_SECRET || '');

  const { prisma } = require('../../src/config/prisma');
  const { ensureRestaurantDemoTenant } = require('../../scripts/ensure-restaurant-demo-tenant');
  try {
    const preExisting = await prisma.tenant.findMany({ select: { id: true, subdomain: true } });
    if (preExisting.some((row) => row.subdomain !== config.tenantSubdomain)) {
      throw new Error('P15 LAB bloqueado: la base contiene un tenant distinto a demo-restaurante.');
    }

    const seeded = await ensureRestaurantDemoTenant();
    const tenant = await prisma.tenant.findUnique({ where: { subdomain: config.tenantSubdomain } });
    if (!tenant || tenant.id !== seeded.tenantId) throw new Error('No se pudo fijar demo-restaurante como tenant único.');

    const hash = await bcrypt.hash(password, 12);
    await prisma.user.updateMany({
      where: { tenantId: tenant.id, email: { in: LAB_USERS } },
      data: { password: hash, activo: true }
    });

    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id, email: { in: LAB_USERS } },
      select: { email: true, rol: true, activo: true },
      orderBy: { email: 'asc' }
    });
    if (users.length !== LAB_USERS.length || users.some((row) => !row.activo)) throw new Error('Bootstrap P15 dejó usuarios de prueba incompletos.');

    const counts = {
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count({ where: { tenantId: tenant.id } }),
      products: await prisma.producto.count({ where: { tenantId: tenant.id } }),
      tables: await prisma.restaurantTable.count({ where: { tenantId: tenant.id } }),
      menuItems: await prisma.restaurantMenuItem.count({ where: { tenantId: tenant.id } })
    };
    if (counts.tenants !== 1 || counts.tables < 6 || counts.products < 10 || counts.menuItems < 4) {
      throw new Error(`Bootstrap P15 incompleto: ${JSON.stringify(counts)}`);
    }

    const result = { ok: true, marker: config.marker, tenant: config.tenantSubdomain, installationId: config.installationId, users, counts };
    console.log(`P15_BOOTSTRAP_READY ${JSON.stringify(result)}`);
    return result;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  bootstrap(process.env).catch((error) => {
    console.error(`P15_BOOTSTRAP_FAILED: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}

module.exports = { bootstrap, LAB_USERS };
