const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const purchase = require('../src/modules/commercial/purchase.service');
const treasury = require('../src/modules/treasury/treasury.service');
const governance = require('../src/modules/accounting/accounting-governance.service');

function n(v) { return Number(v || 0); }
function balanced(j) { return Math.abs(n(j.totalDebito) - n(j.totalCredito)) < 0.005; }

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa: `Purchases QA ${stamp}`, subdomain: `purchases-${stamp}`, nicho: 'QA', pais: 'CO', moneda: 'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Admin Compras', email: `purchases-${stamp}@example.com`, password: 'not-used', rol: 'ADMIN' }
  });
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));

  const supplier = await prisma.tercero.create({
    data: {
      tenantId: tenant.id,
      tipo: 'PROVEEDOR',
      tipoDocumento: 'NIT',
      identificacion: `900-${stamp}`,
      nombre: 'Proveedor QA Compras',
      razonSocial: 'Proveedor QA Compras SAS',
      diasPlazo: 30,
      cupoCredito: 10000000
    }
  });
  const product = await prisma.producto.create({
    data: {
      tenantId: tenant.id,
      tipo: 'PRODUCTO',
      sku: `PUR-${stamp}`,
      nombre: 'Mercancía QA',
      unidadMedida: 'UND',
      controlaInventario: true,
      costoPromedio: 0,
      stockActual: 0,
      precio1: 0,
      ivaPct: 19,
      activo: true
    }
  });

  // Criterio 1 + 2: crear borrador real, editable y sin efectos.
  const draft = await purchase.createDraft(tenant.id, user.id, {
    proveedorId: supplier.id,
    fecha: new Date(),
    referenciaExterna: `FAC-PROV-${stamp}`,
    condicionPagoDias: 30,
    detalles: [{ productoId: product.id, cantidad: 5, costoUnitario: 20000, ivaPct: 19 }]
  });
  assert.equal(draft.estado, 'BORRADOR');
  assert.equal(draft.referenciaExterna, `FAC-PROV-${stamp}`);
  assert.equal(await prisma.asientoContable.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  assert.equal(await prisma.movimientoInventario.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  assert.equal(await prisma.cartera.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);
  let p = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(n(p.stockActual), 0);

  const updated = await purchase.updateDraft(tenant.id, user.id, draft.id, {
    referenciaExterna: `FAC-PROV-${stamp}-EDITADA`,
    detalles: [{ productoId: product.id, cantidad: 6, costoUnitario: 20000, ivaPct: 19 }]
  });
  assert.equal(updated.estado, 'BORRADOR');
  assert.equal(updated.referenciaExterna, `FAC-PROV-${stamp}-EDITADA`);
  assert.equal(await prisma.movimientoInventario.count({ where: { tenantId: tenant.id, comprobanteId: draft.id } }), 0);

  // Criterio 3: emisión atómica -> AU + Kardex + CxP.
  const emitted = await purchase.emit(tenant.id, user.id, draft.id);
  assert.equal(emitted.estado, 'EMITIDO');
  assert.ok(emitted.asiento, 'La compra emitida debe tener asiento');
  assert.equal(emitted.asiento.tipoComprobante?.codigo, 'AU');
  assert.ok(balanced(emitted.asiento), 'El AU debe cuadrar');
  assert.equal(emitted.movimientosInventario.length, 1);
  assert.equal(emitted.cartera.length, 1);
  p = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(n(p.stockActual), 6);
  assert.equal(n(p.costoPromedio), 20000);
  assert.equal(n(emitted.subtotal), 120000);
  assert.equal(n(emitted.ivaTotal), 22800);
  assert.equal(n(emitted.saldo), 142800);
  assert.equal(n(emitted.cartera[0].saldo), 142800);
  assert.equal(emitted.asiento.referencia, emitted.numero);

  // Criterio 4: anular sin pagos revierte asiento, Kardex y CxP exactamente.
  await purchase.cancel(tenant.id, user.id, emitted.id, 'Error de factura proveedor QA');
  const cancelled = await prisma.comprobanteComercial.findUnique({ where: { id: emitted.id }, include: { asiento: true, cartera: true } });
  assert.equal(cancelled.estado, 'ANULADO');
  assert.equal(n(cancelled.saldo), 0);
  assert.equal(cancelled.asiento.estado, 'ANULADO');
  assert.equal(cancelled.cartera[0].estado, 'ANULADA');
  assert.equal(n(cancelled.cartera[0].saldo), 0);
  const reversal = await prisma.asientoContable.findFirst({ where: { tenantId: tenant.id, reversoDeId: cancelled.asiento.id, estado: 'CONTABILIZADO' } });
  assert.ok(reversal, 'Debe existir asiento de reversión');
  assert.ok(balanced(reversal));
  p = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(n(p.stockActual), 0, 'Kardex debe regresar al stock previo');

  // Criterio 5a: compra con pago aplicado no se puede anular.
  const draftPaid = await purchase.createDraft(tenant.id, user.id, {
    proveedorId: supplier.id,
    fecha: new Date(),
    referenciaExterna: `FAC-PAGO-${stamp}`,
    condicionPagoDias: 30,
    detalles: [{ productoId: product.id, cantidad: 3, costoUnitario: 10000, ivaPct: 0 }]
  });
  const paidPurchase = await purchase.emit(tenant.id, user.id, draftPaid.id);
  const bankAccount = await prisma.cuentaPUC.findFirst({ where: { tenantId: tenant.id, codigo: '111005' } });
  const bank = await treasury.createCajaBanco(tenant.id, {
    tipo: 'BANCO',
    nombre: `Banco Compras ${stamp}`,
    banco: 'Banco QA',
    numeroCuenta: String(stamp),
    cuentaContableId: bankAccount.id,
    saldoActual: 1000000,
    activo: true
  });
  await treasury.registerPayment(tenant.id, user.id, {
    documentoId: paidPurchase.id,
    monto: 10000,
    metodoPago: 'TRANSFERENCIA',
    cajaBancoId: bank.id,
    referencia: 'PAGO QA',
    sourceId: `PUR-PAY-${stamp}`
  });
  let paymentBlocked = null;
  try { await purchase.cancel(tenant.id, user.id, paidPurchase.id, 'No debe permitir'); }
  catch (error) { paymentBlocked = error; }
  assert.ok(paymentBlocked);
  assert.equal(paymentBlocked.code, 'PURCHASE_HAS_PAYMENTS');
  const stillPaid = await prisma.comprobanteComercial.findUnique({ where: { id: paidPurchase.id } });
  assert.equal(stillPaid.estado, 'PAGADO_PARCIAL');

  // Criterio 5b/6: periodo cerrado bloquea emisión y todo hace rollback.
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  await governance.closePeriod(tenant.id, user.id, year, month);
  const closedDraft = await purchase.createDraft(tenant.id, user.id, {
    proveedorId: supplier.id,
    fecha: now,
    referenciaExterna: `FAC-CLOSED-${stamp}`,
    condicionPagoDias: 60,
    detalles: [{ productoId: product.id, cantidad: 1, costoUnitario: 5000, ivaPct: 0 }]
  });
  const before = await prisma.producto.findUnique({ where: { id: product.id } });
  const beforeMov = await prisma.movimientoInventario.count({ where: { tenantId: tenant.id, comprobanteId: closedDraft.id } });
  let closedError = null;
  try { await purchase.emit(tenant.id, user.id, closedDraft.id); }
  catch (error) { closedError = error; }
  assert.ok(closedError);
  assert.equal(closedError.code, 'ACCOUNTING_PERIOD_CLOSED');
  assert.equal(closedError.message, 'El periodo contable de esta fecha está cerrado.');
  const closedAfter = await prisma.comprobanteComercial.findUnique({ where: { id: closedDraft.id } });
  const after = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(closedAfter.estado, 'BORRADOR');
  assert.equal(n(after.stockActual), n(before.stockActual));
  assert.equal(await prisma.movimientoInventario.count({ where: { tenantId: tenant.id, comprobanteId: closedDraft.id } }), beforeMov);
  assert.equal(await prisma.asientoContable.count({ where: { tenantId: tenant.id, comprobanteId: closedDraft.id } }), 0);
  assert.equal(await prisma.cartera.count({ where: { tenantId: tenant.id, comprobanteId: closedDraft.id } }), 0);

  console.log('PURCHASES OPERATIONAL SMOKE OK');
  console.log(JSON.stringify({
    tenant: tenant.subdomain,
    draftWithoutEffects: true,
    emittedAU: emitted.asiento.numeroComprobante,
    emittedStock: 6,
    emittedCxP: 142800,
    cancellationRestoredStock: 0,
    paymentCancellationBlocked: paymentBlocked.code,
    closedPeriodBlocked: closedError.code
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
