const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const commercial = require('../src/modules/commercial/commercial.service');
const inventory = require('../src/modules/inventory/inventory.service');
const inventoryAccounting = require('../src/modules/inventory/inventory-accounting.service');
const treasury = require('../src/modules/treasury/treasury.service');
const treasuryIntegration = require('../src/modules/treasury/treasury-integration.service');
const carteraReport = require('../src/modules/treasury/cartera-report.service');
const accounting = require('../src/modules/accounting/accounting.service');
const integration = require('../src/modules/accounting/accounting-integration.service');
const governance = require('../src/modules/accounting/accounting-governance.service');

function n(v) { return Number(v || 0); }
function balanced(journal) { return Math.abs(n(journal.totalDebito) - n(journal.totalCredito)) < 0.005; }

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa: `Core Integration ${stamp}`, subdomain: `core-int-${stamp}`, nicho: 'QA', pais: 'CO', moneda: 'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Admin Integración', email: `admin-${stamp}@example.com`, password: 'test-not-login', rol: 'ADMIN' }
  });
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));

  const account = async (codigo) => {
    const found = await prisma.cuentaPUC.findFirst({ where: { tenantId: tenant.id, codigo, activa: true, permiteMovimiento: true } });
    assert.ok(found, `Cuenta ${codigo} debe existir`);
    return found;
  };
  const otherExpense = await account('519595');
  const otherIncome = await account('429505');
  await integration.setMapping(tenant.id, user.id, 'GASTO_FALTANTE_INVENTARIO', otherExpense.id);
  await integration.setMapping(tenant.id, user.id, 'INGRESO_SOBRANTE_INVENTARIO', otherIncome.id);
  await integration.setMapping(tenant.id, user.id, 'GASTO_DIRECTO', otherExpense.id);

  const status = await integration.integrationStatus(tenant.id);
  assert.equal(status.ready, true, `Integración debe quedar lista: ${JSON.stringify(status.modules)}`);

  const bankAccount = await account('111005');
  const cashAccount = await account('110505');
  const bank = await treasury.createCajaBanco(tenant.id, {
    tipo: 'BANCO', nombre: `Banco QA ${stamp}`, banco: 'Banco QA', numeroCuenta: String(stamp), cuentaContableId: bankAccount.id, saldoActual: 1000000, activo: true
  });
  const cash = await treasury.createCajaBanco(tenant.id, {
    tipo: 'CAJA', nombre: `Caja QA ${stamp}`, cuentaContableId: cashAccount.id, saldoActual: 100000, activo: true
  });

  const supplier = await prisma.tercero.create({
    data: { tenantId: tenant.id, tipo: 'PROVEEDOR', tipoDocumento: 'NIT', identificacion: `SUP-${stamp}`, nombre: 'Proveedor Integración', razonSocial: 'Proveedor Integración SAS', cupoCredito: 10000000, diasPlazo: 30 }
  });
  const customer = await prisma.tercero.create({
    data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'NIT', identificacion: `CLI-${stamp}`, nombre: 'Cliente Integración', razonSocial: 'Cliente Integración SAS', cupoCredito: 10000000, diasPlazo: 30 }
  });
  const product = await inventory.createProduct(tenant.id, {
    tipo: 'PRODUCTO', sku: `INT-${stamp}`, nombre: 'Producto Integración', unidadMedida: 'UND', controlaInventario: true,
    costoPromedio: 0, stockActual: 0, precio1: 35000, ivaPct: 19, impoconsumoPct: 0, activo: true
  });

  // 1-2. Compra a crédito -> Kardex + CxP + AU.
  const purchase = await commercial.createDocument(tenant.id, user.id, {
    tipo: 'COMPRA', estado: 'EMITIDO', terceroId: supplier.id, formaPago: 'CREDITO', sourceId: `INT-PUR-${stamp}`,
    fechaVencimiento: new Date(Date.now() + 30 * 86400000),
    detalles: [{ productoId: product.id, cantidad: 10, precioUnitario: 20000, ivaPct: 19 }]
  });
  assert.equal(purchase.tipo, 'COMPRA');
  assert.ok(purchase.asiento, 'Compra debe crear asiento');
  assert.ok(balanced(purchase.asiento), 'Asiento compra debe cuadrar');
  assert.equal(purchase.asiento.tipoComprobante?.codigo, 'AU');
  let stocked = await inventory.getProduct(tenant.id, product.id);
  assert.equal(n(stocked.stockActual), 10);
  assert.equal(n(stocked.costoPromedio), 20000);
  assert.equal(n(purchase.saldo), 238000);

  // 3. Pago parcial proveedor -> CxP + banco + AU.
  const supplierPayment = await treasuryIntegration.allocatePaymentBatch(tenant.id, user.id, {
    cajaBancoId: bank.id, metodoPago: 'TRANSFERENCIA', referencia: 'PAGO PARCIAL QA', sourceId: `INT-PAY-SUP-${stamp}`,
    aplicaciones: [{ documentoId: purchase.id, monto: 30000 }]
  });
  assert.equal(supplierPayment.aplicaciones.length, 1);
  assert.ok(balanced(supplierPayment.aplicaciones[0].asiento));
  assert.equal(n(supplierPayment.aplicaciones[0].saldo), 208000);

  // 4-5. Venta a crédito -> CxC + ingreso/IVA + costo/inventario + AU.
  const sale = await commercial.createDocument(tenant.id, user.id, {
    tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', sourceId: `INT-SALE-${stamp}`,
    fechaVencimiento: new Date(Date.now() + 30 * 86400000),
    detalles: [{ productoId: product.id, cantidad: 2, precioUnitario: 35000, ivaPct: 19 }]
  });
  assert.ok(sale.asiento && balanced(sale.asiento), 'Venta debe crear AU cuadrado');
  assert.equal(sale.asiento.tipoComprobante?.codigo, 'AU');
  stocked = await inventory.getProduct(tenant.id, product.id);
  assert.equal(n(stocked.stockActual), 8);
  assert.equal(n(sale.saldo), 83300);
  const saleCogsDebit = sale.asiento.detalles.filter((d) => d.cuenta.codigo === '613505').reduce((a, d) => a + n(d.debito), 0);
  assert.equal(saleCogsDebit, 40000, 'Costo de venta debe usar costo del Kardex');

  // 6. Recaudo cliente -> CxC + banco + AU.
  const collection = await treasuryIntegration.allocatePaymentBatch(tenant.id, user.id, {
    cajaBancoId: bank.id, metodoPago: 'TRANSFERENCIA', referencia: 'RECAUDO QA', sourceId: `INT-PAY-CLI-${stamp}`,
    aplicaciones: [{ documentoId: sale.id, monto: 50000 }]
  });
  assert.ok(balanced(collection.aplicaciones[0].asiento));
  assert.equal(n(collection.aplicaciones[0].saldo), 33300);

  // Cartera es la misma información conciliada con auxiliares contables.
  const cxc = await carteraReport.accountingReconciliation(tenant.id, 'CXC');
  const cxp = await carteraReport.accountingReconciliation(tenant.id, 'CXP');
  assert.equal(cxc.cuadra, true, `CxC debe cuadrar: ${JSON.stringify(cxc)}`);
  assert.equal(cxp.cuadra, true, `CxP debe cuadrar: ${JSON.stringify(cxp)}`);
  const aging = await carteraReport.aging(tenant.id, {});
  assert.equal(n(aging.totales.TOTAL), 241300);

  // Ajuste manual de inventario -> AU propio y justificación.
  const adjustment = await inventoryAccounting.createAccountedAdjustment(tenant.id, user.id, {
    productoId: product.id, tipo: 'AJUSTE_ENTRADA', cantidad: 1, costoUnitario: 20000,
    justificacion: 'Sobrante físico verificado en conteo QA', sourceId: `INT-ADJ-${stamp}`
  });
  assert.ok(balanced(adjustment.asiento));
  stocked = await inventory.getProduct(tenant.id, product.id);
  assert.equal(n(stocked.stockActual), 9);

  // Tesorería patrimonial: transferencia no toca resultados.
  const transfer = await treasuryIntegration.transferOwnFunds(tenant.id, user.id, {
    origenCajaBancoId: bank.id, destinoCajaBancoId: cash.id, monto: 10000,
    concepto: 'Traslado QA', sourceId: `INT-TR-${stamp}`
  });
  assert.ok(balanced(transfer.asiento));
  const transferCodes = new Set(transfer.asiento.detalles.map((d) => d.cuenta.codigo));
  assert.ok(transferCodes.has('111005') && transferCodes.has('110505'));

  // Gasto directo -> gasto DR / banco CR.
  const expense = await treasuryIntegration.directExpense(tenant.id, user.id, {
    cajaBancoId: bank.id, monto: 5000, concepto: 'Gasto menor QA', sourceId: `INT-GD-${stamp}`
  });
  assert.ok(balanced(expense.asiento));
  assert.ok(expense.asiento.detalles.some((d) => d.cuenta.codigo === '519595' && n(d.debito) === 5000));

  // 7. Estados financieros deben seguir matemáticamente balanceados.
  const today = new Date().toISOString().slice(0, 10);
  const bs = await accounting.getBalanceSheet(tenant.id, { corte: today });
  assert.ok(Math.abs(n(bs.diferencia)) < 0.01, `Balance General descuadrado: ${bs.diferencia}`);
  const pl = await accounting.getProfitAndLoss(tenant.id, { desde: `${new Date().getUTCFullYear()}-01-01`, hasta: today });
  assert.ok(pl, 'P&G debe responder');

  // 8. Cierre bloquea la operación origen y revierte toda la transacción.
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  await governance.closePeriod(tenant.id, user.id, year, month);
  const beforeProduct = await inventory.getProduct(tenant.id, product.id);
  const beforeCount = await prisma.comprobanteComercial.count({ where: { tenantId: tenant.id, tipo: 'FACTURA_VENTA' } });
  let blocked = null;
  try {
    await commercial.createDocument(tenant.id, user.id, {
      tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', sourceId: `INT-CLOSED-${stamp}`,
      fecha: now, detalles: [{ productoId: product.id, cantidad: 1, precioUnitario: 35000, ivaPct: 19 }]
    });
  } catch (error) { blocked = error; }
  assert.ok(blocked, 'Venta retroactiva debe bloquearse');
  assert.equal(blocked.code, 'ACCOUNTING_PERIOD_CLOSED');
  const afterProduct = await inventory.getProduct(tenant.id, product.id);
  const afterCount = await prisma.comprobanteComercial.count({ where: { tenantId: tenant.id, tipo: 'FACTURA_VENTA' } });
  assert.equal(n(afterProduct.stockActual), n(beforeProduct.stockActual), 'Stock debe hacer rollback');
  assert.equal(afterCount, beforeCount, 'Documento debe hacer rollback');

  console.log('CORE ACCOUNTING INTEGRATION SMOKE OK');
  console.log(JSON.stringify({
    tenant: tenant.subdomain,
    compra: purchase.numero,
    saldoProveedor: 208000,
    venta: sale.numero,
    saldoCliente: 33300,
    stockFinal: n(afterProduct.stockActual),
    carteraCuadra: cxc.cuadra && cxp.cuadra,
    balanceGeneralDiferencia: n(bs.diferencia),
    cierreBloquea: blocked.code
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
