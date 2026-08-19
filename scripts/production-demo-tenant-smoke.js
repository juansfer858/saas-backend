const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { prisma } = require('../src/config/prisma');
const { DEMO, ensureDemoTenant } = require('./ensure-production-demo-tenant');

async function main() {
  try {
    await ensureDemoTenant();
    await ensureDemoTenant();

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: DEMO.subdomain }
    });
    assert.ok(tenant);
    assert.equal(tenant.nombreEmpresa, DEMO.nombreEmpresa);
    assert.equal(tenant.activo, true);

    const [accounts, cashCount, genericCount, admin] = await Promise.all([
      prisma.cuentaPUC.count({ where: { tenantId: tenant.id } }),
      prisma.cajaBanco.count({ where: { tenantId: tenant.id, nombre: 'Caja General' } }),
      prisma.tercero.count({ where: { tenantId: tenant.id, identificacion: '222222222222' } }),
      prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: DEMO.adminEmail } }
      })
    ]);

    assert.ok(accounts >= 40, `PUC insuficiente: ${accounts}`);
    assert.equal(cashCount, 1);
    assert.equal(genericCount, 1);
    assert.ok(admin);
    assert.equal(admin.rol, 'ADMIN');
    assert.equal(admin.activo, true);
    assert.equal(bcrypt.getRounds(admin.password), 12);

    console.log('PRODUCTION DEMO TENANT SMOKE OK');
    console.log(JSON.stringify({ accounts, cajaGeneral: true, clienteGenerico: true, admin: true, idempotente: true }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
