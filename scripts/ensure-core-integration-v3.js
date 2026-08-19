const { prisma } = require('../src/config/prisma');
const integration = require('../src/modules/integration/core-integration.service');

async function ensureCoreIntegrationV3() {
  const tenants = await prisma.tenant.findMany({ where: { activo: true }, orderBy: { creadoEn: 'asc' } });
  const results = [];
  for (const tenant of tenants) {
    await integration.ensureIntegrationDefaults(tenant.id);
    const config = await integration.getParametrization(tenant.id);
    results.push({
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      metodoCosteo: config.config.metodoCosteo,
      parametros: config.parametros.length,
      configurados: config.parametros.filter((x) => x.configurado).length
    });
  }
  return results;
}

async function main() {
  const results = await ensureCoreIntegrationV3();
  console.log('CORE ACCOUNTING INTEGRATION V3 READY', JSON.stringify({ tenants: results.length, results }));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('CORE ACCOUNTING INTEGRATION V3 ERROR', error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}

module.exports = { ensureCoreIntegrationV3 };
