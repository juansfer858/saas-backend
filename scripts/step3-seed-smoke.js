const assert = require('node:assert/strict');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { PUC_CO_VERSION, ACCOUNTING_MAPPING_CODES } = require('../src/seeds/puc-templates');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const subdomain = `seed-${Date.now()}`;

  try {
    const response = await fetch(`${base}/api/v1/auth/register-tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombreEmpresa: 'QA Seed Empresa',
        nicho: 'ERP',
        subdomain,
        pais: 'CO',
        moneda: 'COP',
        admin: {
          nombre: 'Admin Seed',
          email: `seed-${Date.now()}@qa.local`,
          password: 'CoreSeed2026!'
        }
      })
    });

    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));

    const tenant = await prisma.tenant.findUnique({ where: { subdomain } });
    assert.ok(tenant);

    const accountsBefore = await prisma.cuentaPUC.findMany({ where: { tenantId: tenant.id } });
    const mappingsBefore = await prisma.mapeoContable.findMany({ where: { tenantId: tenant.id } });
    const cashBefore = await prisma.cajaBanco.findMany({
      where: { tenantId: tenant.id, nombre: 'Caja General' }
    });
    const genericBefore = await prisma.tercero.findMany({
      where: { tenantId: tenant.id, identificacion: '222222222222' }
    });

    assert.ok(accountsBefore.length >= 40, `PUC operativo insuficiente: ${accountsBefore.length}`);
    assert.equal(mappingsBefore.length, Object.keys(ACCOUNTING_MAPPING_CODES).length);
    assert.equal(cashBefore.length, 1);
    assert.equal(genericBefore.length, 1);

    const clientes = accountsBefore.find((account) => account.codigo === '130505');
    const proveedores = accountsBefore.find((account) => account.codigo === '220505');
    const ivaGenerado = accountsBefore.find((account) => account.codigo === '240801');
    const ivaDescontable = accountsBefore.find((account) => account.codigo === '240802');

    assert.ok(clientes?.requiereTercero);
    assert.ok(proveedores?.requiereTercero);
    assert.equal(clientes.versionCatalogo, PUC_CO_VERSION);
    assert.equal(ivaGenerado?.permiteMovimiento, true);
    assert.equal(ivaDescontable?.permiteMovimiento, true);

    const summary = await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));
    assert.equal(summary.versionCatalogo, PUC_CO_VERSION);

    const [accountsAfter, mappingsAfter, cashAfter, genericAfter] = await Promise.all([
      prisma.cuentaPUC.count({ where: { tenantId: tenant.id } }),
      prisma.mapeoContable.count({ where: { tenantId: tenant.id } }),
      prisma.cajaBanco.count({ where: { tenantId: tenant.id, nombre: 'Caja General' } }),
      prisma.tercero.count({ where: { tenantId: tenant.id, identificacion: '222222222222' } })
    ]);

    assert.equal(accountsAfter, accountsBefore.length);
    assert.equal(mappingsAfter, mappingsBefore.length);
    assert.equal(cashAfter, 1);
    assert.equal(genericAfter, 1);

    console.log('STEP 3 SEED SMOKE OK');
    console.log(JSON.stringify({
      versionCatalogo: PUC_CO_VERSION,
      cuentas: accountsAfter,
      mapeos: mappingsAfter,
      cajaGeneral: cashAfter === 1,
      clienteGenerico: genericAfter === 1,
      idempotente: true
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
