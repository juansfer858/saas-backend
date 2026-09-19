'use strict';

const bcrypt = require('bcryptjs');
const path = require('node:path');

if (require.main === module) {
  require('dotenv').config({ path: process.env.P14_ENV_FILE || path.join(__dirname, '.env') });
}

const { assertRestaurantP14RuntimeConfig } = require('./runtime-config');

const LOCAL_ADMIN_EMAIL = 'admin@demo-restaurante.vantixgc.com';

async function bootstrap(env = process.env) {
  const config = assertRestaurantP14RuntimeConfig(env);
  if (config.tenantSubdomain !== 'demo-restaurante' || config.installationId !== 'HOME-PILOT-01') {
    throw new Error('P14 bootstrap sólo puede ejecutarse para demo-restaurante/HOME-PILOT-01.');
  }

  process.env.JWT_SECRET = String(env.P14_JWT_SECRET || '');
  const adminPassword = String(env.P14_ADMIN_PASSWORD || '');
  if (adminPassword.length < 12) {
    throw new Error('P14_ADMIN_PASSWORD debe tener al menos 12 caracteres y sólo se usa durante el bootstrap local.');
  }

  const { prisma } = require('../../src/config/prisma');
  const { ensureRestaurantDemoTenant } = require('../../scripts/ensure-restaurant-demo-tenant');

  try {
    const before = await prisma.tenant.findMany({
      select: { id: true, subdomain: true }
    });
    if (before.some((tenant) => tenant.subdomain !== config.tenantSubdomain)) {
      throw new Error('P14 bloqueado: la base local contiene un tenant distinto al piloto autorizado.');
    }

    const seeded = await ensureRestaurantDemoTenant();
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: config.tenantSubdomain }
    });
    if (!tenant || tenant.id !== seeded.tenantId) {
      throw new Error('P14 no pudo fijar la identidad single-tenant local.');
    }

    // P14-1A valida únicamente el acceso administrativo. Los usuarios de roles
    // operativos se habilitarán después, con credenciales propias, en la frontera
    // que abra Mesero/KDS. Nunca dejamos activas las credenciales demo del seed.
    await prisma.user.updateMany({
      where: {
        tenantId: tenant.id,
        email: { not: LOCAL_ADMIN_EMAIL }
      },
      data: { activo: false }
    });

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const admin = await prisma.user.update({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: LOCAL_ADMIN_EMAIL
        }
      },
      data: {
        password: passwordHash,
        activo: true,
        rol: 'ADMIN'
      },
      select: {
        id: true,
        email: true,
        rol: true,
        activo: true
      }
    });

    const tenants = await prisma.tenant.findMany({
      select: { id: true, subdomain: true, nombreEmpresa: true }
    });
    if (tenants.length !== 1 || tenants[0].subdomain !== config.tenantSubdomain) {
      throw new Error('P14 bloqueado: la base local dejó de ser single-tenant.');
    }

    const counts = Object.freeze({
      users: await prisma.user.count({ where: { tenantId: tenant.id } }),
      activeUsers: await prisma.user.count({ where: { tenantId: tenant.id, activo: true } }),
      inactiveOperationalUsers: await prisma.user.count({
        where: {
          tenantId: tenant.id,
          activo: false,
          email: { not: LOCAL_ADMIN_EMAIL }
        }
      }),
      products: await prisma.producto.count({ where: { tenantId: tenant.id } }),
      tables: await prisma.restaurantTable.count({ where: { tenantId: tenant.id } }),
      menuItems: await prisma.restaurantMenuItem.count({ where: { tenantId: tenant.id } })
    });

    if (
      counts.users < 6 ||
      counts.activeUsers !== 1 ||
      counts.inactiveOperationalUsers < 5 ||
      counts.products < 10 ||
      counts.tables !== 6 ||
      counts.menuItems < 4
    ) {
      throw new Error(`P14 bootstrap incompleto o inseguro: ${JSON.stringify(counts)}.`);
    }

    const result = Object.freeze({
      ok: true,
      phase: 'P14-1A',
      localOnly: true,
      tenant: Object.freeze({
        id: tenant.id,
        subdomain: tenant.subdomain,
        nombreEmpresa: tenant.nombreEmpresa
      }),
      installationId: config.installationId,
      admin: Object.freeze({
        email: admin.email,
        role: admin.rol,
        active: admin.activo
      }),
      operationalUsers: 'DISABLED_UNTIL_P14_OPERATIONAL_BOUNDARIES',
      counts
    });

    console.log(`P14_BOOTSTRAP_READY ${JSON.stringify(result)}`);
    return result;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  bootstrap(process.env).catch((error) => {
    console.error(`P14_BOOTSTRAP_FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { LOCAL_ADMIN_EMAIL, bootstrap };
