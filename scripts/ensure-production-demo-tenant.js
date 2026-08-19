const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');

const DEMO = {
  nombreEmpresa: 'VantixGC Demo Core',
  subdomain: 'demo-core',
  nicho: 'ERP',
  pais: 'CO',
  moneda: 'COP',
  adminNombre: 'Administrador Demo Core',
  adminEmail: 'admin@demo-core.vantixgc.com',
  // Solo se almacena el hash bcrypt. La contraseña en texto plano nunca vive en el repositorio.
  adminPasswordHash: '$2y$12$D8g5.rrzj2zyeDch7EfaSeZGiuY3v/le.rF97fN5vT9j.QkbG7LKa'
};

async function ensureDemoTenant() {
  return prisma.$transaction(async (tx) => {
    let tenant = await tx.tenant.findUnique({ where: { subdomain: DEMO.subdomain } });

    if (!tenant) {
      tenant = await tx.tenant.create({
        data: {
          nombreEmpresa: DEMO.nombreEmpresa,
          subdomain: DEMO.subdomain,
          nicho: DEMO.nicho,
          pais: DEMO.pais,
          moneda: DEMO.moneda,
          activo: true
        }
      });
    } else if (!tenant.activo || tenant.nombreEmpresa !== DEMO.nombreEmpresa) {
      tenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: { nombreEmpresa: DEMO.nombreEmpresa, activo: true }
      });
    }

    const existingAdmin = await tx.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: DEMO.adminEmail
        }
      }
    });

    if (!existingAdmin) {
      await tx.user.create({
        data: {
          tenantId: tenant.id,
          nombre: DEMO.adminNombre,
          email: DEMO.adminEmail,
          password: DEMO.adminPasswordHash,
          rol: 'ADMIN',
          activo: true
        }
      });
    }

    await seedTenantDefaults(tx, tenant);

    return {
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      adminCreated: !existingAdmin
    };
  });
}

async function main() {
  const result = await ensureDemoTenant();
  console.log('DEMO TENANT READY', JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error('DEMO TENANT BOOTSTRAP ERROR', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

module.exports = { ensureDemoTenant };
