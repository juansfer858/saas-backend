const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const commercial = require('../src/modules/commercial/commercial.service');
const taxes = require('../src/modules/accounting/accounting-tax.service');

function n(v) { return Number(v || 0); }

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa: 'Fiscal Automation Smoke', subdomain: `fiscal-${suffix}`, nicho: 'ERP', pais: 'CO', moneda: 'COP' }
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Admin Fiscal', email: `admin-${suffix}@test.local`, password: 'not-used', rol: 'ADMIN' }
  });
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));

  const supplier = await prisma.tercero.create({
    data: {
      tenantId: tenant.id, tipo: 'PROVEEDOR', tipoDocumento: 'NIT', identificacion: `P-${suffix}`,
      nombre: 'Proveedor sujeto retención', sujetoRetefuente: true, activo: true
    }
  });
  const customer = await prisma.tercero.create({
    data: {
      tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'NIT', identificacion: `C-${suffix}`,
      nombre: 'Cliente sujeto retención', sujetoRetefuente: true, activo: true
    }
  });
  const service = await prisma.producto.create({
    data: {
      tenantId: tenant.id, tipo: 'SERVICIO', sku: `S-${suffix}`, nombre: 'Servicio fiscal', controlaInventario: false,
      precio1: 100000, costoPromedio: 0, stockActual: 0, ivaPct: 19, impoconsumoPct: 0, activo: true
    }
  });

  const payableAccount = await prisma.cuentaPUC.findUnique({ where: { tenantId_codigo: { tenantId: tenant.id, codigo: '236540' } } });
  const receivableAccount = await prisma.cuentaPUC.findUnique({ where: { tenantId_codigo: { tenantId: tenant.id, codigo: '135515' } } });
  assert.ok(payableAccount && receivableAccount);

  const purchaseTemplate = await prisma.conceptoRetencion.findUnique({ where: { tenantId_codigo: { tenantId: tenant.id, codigo: 'RTF-COMPRAS' } } });
  await taxes.upsertRetention(tenant.id, user.id, {
    codigo: purchaseTemplate.codigo,
    nombre: purchaseTemplate.nombre,
    tipo: 'RETEFUENTE',
    porcentaje: 2.5,
    baseMinima: 0,
    cuentaId: payableAccount.id,
    naturaleza: 'PAGAR',
    automatico: true,
    activo: true
  }, purchaseTemplate.id);
  const saleRetention = await taxes.upsertRetention(tenant.id, user.id, {
    codigo: 'RTF-VENTAS',
    nombre: 'Retención a favor en ventas',
    tipo: 'RETEFUENTE',
    porcentaje: 1,
    baseMinima: 0,
    cuentaId: receivableAccount.id,
    naturaleza: 'COBRAR',
    automatico: true,
    activo: true
  });

  const purchase = await commercial.createDocument(tenant.id, user.id, {
    tipo: 'COMPRA', estado: 'EMITIDO', terceroId: supplier.id, formaPago: 'CREDITO', sourceId: `PUR-${suffix}`,
    detalles: [{ productoId: service.id, cantidad: 1, precioUnitario: 100000, descuentoPct: 0, ivaPct: 19, impoconsumoPct: 0 }]
  });
  assert.equal(n(purchase.total), 119000);
  assert.equal(n(purchase.retencionTotal), 2500);
  assert.equal(n(purchase.netoPagar), 116500);
  assert.equal(n(purchase.saldo), 116500);
  assert.equal(purchase.retenciones.length, 1);
  assert.equal(purchase.retenciones[0].codigo, 'RTF-COMPRAS');
  assert.equal(n(purchase.asiento.totalDebito), n(purchase.asiento.totalCredito));
  assert.ok(purchase.asiento.detalles.some((x) => x.conceptoRetencionId === purchaseTemplate.id && n(x.credito) === 2500));
  const purchaseCxp = await prisma.cartera.findFirst({ where: { tenantId: tenant.id, comprobanteId: purchase.id, tipo: 'CXP' } });
  assert.equal(n(purchaseCxp.saldo), 116500, 'CXP debe quedar neta de retención');

  const sale = await commercial.createDocument(tenant.id, user.id, {
    tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', sourceId: `SALE-${suffix}`,
    detalles: [{ productoId: service.id, cantidad: 1, precioUnitario: 100000, descuentoPct: 0, ivaPct: 19, impoconsumoPct: 0 }]
  });
  assert.equal(n(sale.total), 119000);
  assert.equal(n(sale.retencionTotal), 1000);
  assert.equal(n(sale.netoPagar), 118000);
  assert.equal(n(sale.saldo), 118000);
  assert.equal(sale.retenciones.length, 1);
  assert.equal(sale.retenciones[0].codigo, 'RTF-VENTAS');
  assert.equal(n(sale.asiento.totalDebito), n(sale.asiento.totalCredito));
  assert.ok(sale.asiento.detalles.some((x) => x.conceptoRetencionId === saleRetention.id && n(x.debito) === 1000));
  const saleCxc = await prisma.cartera.findFirst({ where: { tenantId: tenant.id, comprobanteId: sale.id, tipo: 'CXC' } });
  assert.equal(n(saleCxc.saldo), 118000, 'CxC debe quedar neta de retención');

  const grossAccounts = await Promise.all(['519595', '220505'].map((codigo) => prisma.cuentaPUC.findUnique({ where: { tenantId_codigo: { tenantId: tenant.id, codigo } } })));
  const fiscalJournal = await taxes.createFiscalJournal(tenant.id, user.id, {
    fecha: new Date('2026-08-19T12:00:00.000Z'),
    concepto: 'Asiento fiscal manual automático',
    terceroId: supplier.id,
    tipoOperacion: 'COMPRA',
    cuentaBaseId: grossAccounts[0].id,
    cuentaContrapartidaId: grossAccounts[1].id,
    base: 100000,
    tarifaIvaId: (await prisma.tarifaIVA.findUnique({ where: { tenantId_codigo: { tenantId: tenant.id, codigo: 'IVA19' } } })).id
  });
  assert.equal(n(fiscalJournal.totalDebito), n(fiscalJournal.totalCredito));
  assert.ok(fiscalJournal.detalles.some((x) => x.conceptoRetencionId === purchaseTemplate.id));

  const cancelled = await commercial.cancelDocument(tenant.id, user.id, purchase.id, 'Prueba reversión retenciones');
  assert.equal(cancelled.documento.estado, 'ANULADO');
  const reversedJournal = await prisma.asientoContable.findFirst({ where: { tenantId: tenant.id, reversoDeId: purchase.asiento.id }, include: { detalles: true } });
  assert.ok(reversedJournal);
  assert.equal(n(reversedJournal.totalDebito), n(reversedJournal.totalCredito));
  assert.ok(reversedJournal.detalles.some((x) => x.conceptoRetencionId === purchaseTemplate.id && n(x.debito) === 2500));

  console.log('ACCOUNTING FISCAL AUTOMATION SMOKE OK');
  console.log(JSON.stringify({ purchaseGross: 119000, purchaseRetention: 2500, purchaseNet: 116500, saleGross: 119000, saleRetention: 1000, saleNet: 118000, fiscalJournal: true, reversal: true }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
