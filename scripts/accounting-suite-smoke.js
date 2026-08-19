const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { ensureDemoTenant } = require('./ensure-production-demo-tenant');
const { seedDemoAccountingOperations } = require('./seed-demo-accounting-operations');
const accounting = require('../src/modules/accounting/accounting.service');

async function main() {
  await ensureDemoTenant();
  const seeded = await seedDemoAccountingOperations();

  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'demo-core' } });
  assert.ok(tenant);
  assert.equal(seeded.asientos.length, 3, 'Debe crear compra, venta y recibo con asiento');

  for (const journal of seeded.asientos) {
    assert.equal(Number(journal.totalDebito), Number(journal.totalCredito), `Asiento ${journal.referencia} descuadrado`);
    assert.ok(Number(journal.totalDebito) > 0);
    assert.ok(journal.lineas >= 2);
  }

  const cashAccount = await prisma.cuentaPUC.findUnique({
    where: { tenantId_codigo: { tenantId: tenant.id, codigo: '110505' } }
  });
  const ledger = await accounting.getLedger(tenant.id, { cuentaId: cashAccount.id });
  assert.ok(ledger.movimientos.length >= 1, 'Caja General debe tener movimiento por recibo');
  assert.equal(Number(ledger.saldoFinal), 30000);

  const trial = await accounting.getTrialBalance(tenant.id, {});
  assert.equal(trial.balanceado, true);
  assert.equal(Number(trial.totals.debitos), Number(trial.totals.creditos));

  const pnl = await accounting.getProfitAndLoss(tenant.id, {});
  assert.equal(Number(pnl.totales.totalIngresos), 70000);
  assert.equal(Number(pnl.totales.totalCostos), 40000);
  assert.equal(Number(pnl.totales.utilidad), 30000);

  const product = await prisma.producto.findUnique({
    where: { tenantId_sku: { tenantId: tenant.id, sku: 'DEMO-CONT-001' } }
  });
  assert.equal(Number(product.stockActual), 8, 'Kardex debe dejar 8 unidades');
  assert.equal(Number(product.costoPromedio), 20000, 'Costo promedio debe quedar en 20.000');

  const cash = await prisma.cajaBanco.findUnique({
    where: { tenantId_nombre: { tenantId: tenant.id, nombre: 'Caja General' } }
  });
  assert.equal(Number(cash.saldoActual), 30000, 'Tesorería debe reflejar el recibo de caja');

  // Idempotencia: re-ejecutar no debe duplicar documentos, Kardex ni asientos.
  await seedDemoAccountingOperations();
  const journalsAfter = await prisma.asientoContable.count({
    where: {
      tenantId: tenant.id,
      sourceId: { in: ['ACC-DEMO-ACC-PURCHASE-001', 'ACC-DEMO-ACC-SALE-001', 'PAY-DEMO-ACC-PAYMENT-001'] }
    }
  });
  assert.equal(journalsAfter, 3);
  const productAfter = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(Number(productAfter.stockActual), 8);

  console.log('ACCOUNTING SUITE E2E OK');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
