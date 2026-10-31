'use strict';

const bcrypt = require('bcryptjs');
const path = require('node:path');

if (require.main === module) {
  require('dotenv').config({ path: process.env.P13_ENV_FILE || path.join(__dirname, '.env') });
}

const { assertLabConfig } = require('./runtime');

async function bootstrap() {
  const config = assertLabConfig(process.env);
  if (config.tenantSubdomain !== 'demo-restaurante') {
    throw new Error('P13-B1 demo sólo puede ejecutarse con P13_TENANT_SUBDOMAIN=demo-restaurante.');
  }
  const adminPassword = String(process.env.P13_ADMIN_PASSWORD || '');
  if (adminPassword.length < 12) {
    throw new Error('P13_ADMIN_PASSWORD debe tener al menos 12 caracteres y sólo se usa para el laboratorio local.');
  }

  // All imported modules use DATABASE_URL, which assertLabConfig has already pinned
  // to 127.0.0.1:55432/vantix_p13_lab.
  process.env.JWT_SECRET = config.jwtSecret;
  const { prisma } = require('../../src/config/prisma');
  const { ensureRestaurantDemoTenant } = require('../../scripts/ensure-restaurant-demo-tenant');

  try {
    const before = await prisma.tenant.findMany({ select: { id:true, subdomain:true } });
    if (before.some((row) => row.subdomain !== config.tenantSubdomain)) {
      throw new Error('P13 bloqueado: la base local contiene un tenant distinto al tenant fijado.');
    }

    const seeded = await ensureRestaurantDemoTenant();
    const tenant = await prisma.tenant.findUnique({ where: { subdomain: config.tenantSubdomain } });
    if (!tenant || tenant.id !== seeded.tenantId) throw new Error('No fue posible fijar la identidad del tenant local.');

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const admin = await prisma.user.update({
      where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo-restaurante.vantixgc.com' } },
      data: { password: passwordHash, activo: true, rol: 'ADMIN' },
      select: { id:true, email:true, rol:true, activo:true }
    });

    const tenants = await prisma.tenant.findMany({ select: { id:true, subdomain:true, nombreEmpresa:true } });
    if (tenants.length !== 1 || tenants[0].subdomain !== config.tenantSubdomain) {
      throw new Error('P13 bloqueado: la base local dejó de ser single-tenant.');
    }

    const counts = {
      users: await prisma.user.count({ where: { tenantId: tenant.id } }),
      products: await prisma.producto.count({ where: { tenantId: tenant.id } }),
      tables: await prisma.restaurantTable.count({ where: { tenantId: tenant.id } }),
      menuItems: await prisma.restaurantMenuItem.count({ where: { tenantId: tenant.id } })
    };

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-B1',
      localOnly: true,
      tenant: { id: tenant.id, subdomain: tenant.subdomain, nombreEmpresa: tenant.nombreEmpresa },
      admin: { email: admin.email, role: admin.rol, active: admin.activo },
      counts
    }));
    return { tenant, admin, counts };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error(`P13_B1_BOOTSTRAP_FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { bootstrap };
