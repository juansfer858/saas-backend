const { prisma } = require('../src/config/prisma');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');

async function main() {
  const tenants = await prisma.tenant.findMany({ include: { users: { where: { rol: 'ADMIN', activo: true }, orderBy: { creadoEn: 'asc' }, take: 1 } } });
  const results = [];
  for (const tenant of tenants) {
    const result = await prisma.$transaction((tx) => seedPlatformDefaults(tx, tenant, tenant.users[0] || null));
    results.push({ tenantId: tenant.id, subdomain: tenant.subdomain, ...result });
  }
  console.log(`PLATFORM CORE V1 TENANT BOOTSTRAP READY ${JSON.stringify({ tenants: tenants.length, results })}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
