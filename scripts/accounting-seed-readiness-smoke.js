const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const integration = require('../src/modules/accounting/accounting-integration.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Accounting Seed Readiness ${stamp}`,
      subdomain: `accounting-seed-${stamp}`,
      nicho: 'QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });

  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));

  const status = await integration.integrationStatus(tenant.id);
  assert.equal(status.ready, true, `Seed contable debe dejar todos los módulos listos: ${JSON.stringify(status.modules)}`);

  const expected = {
    GASTO_FALTANTE_INVENTARIO: '519595',
    INGRESO_SOBRANTE_INVENTARIO: '429505',
    GASTO_DIRECTO: '519595'
  };

  for (const [key, code] of Object.entries(expected)) {
    const mapping = status.mappings.find((row) => row.clave === key);
    assert.ok(mapping?.ready, `${key} debe quedar configurado por el seed`);
    assert.equal(mapping.cuenta.codigo, code, `${key} debe usar default ${code}`);
  }

  console.log('ACCOUNTING SEED READINESS SMOKE OK');
  console.log(JSON.stringify({ ready: status.ready, modules: status.modules, expected }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
