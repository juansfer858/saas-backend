const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');

async function ensureAllTenantAccountingV2() {
  const tenants = await prisma.tenant.findMany({ orderBy: { creadoEn: 'asc' } });
  const results = [];
  for (const tenant of tenants) {
    const seeded = await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));
    results.push({ tenantId: tenant.id, subdomain: tenant.subdomain, versionCatalogo: seeded.versionCatalogo, cuentas: seeded.cuentas });
  }
  return results;
}

async function main() {
  const results = await ensureAllTenantAccountingV2();
  console.log('ACCOUNTING V2 TENANT UPGRADE READY', JSON.stringify({ tenants: results.length, results }));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('ACCOUNTING V2 TENANT UPGRADE ERROR', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { ensureAllTenantAccountingV2 };
