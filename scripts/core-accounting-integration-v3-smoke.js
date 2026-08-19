const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const integration = require('../src/modules/integration/core-integration.service');
const runtime = require('../src/modules/integration/core-integration.runtime');
const commercial = require('../src/modules/commercial/commercial.service');
const treasury = require('../src/modules/treasury/treasury.service');
const inventory = require('../src/modules/inventory/inventory.service');
const taxes = require('../src/modules/accounting/accounting-tax.service');
const accounting = require('../src/modules/accounting/accounting.service');
const governance = require('../src/modules/accounting/accounting-governance.service');

const DATE = new Date('2026-08-10T12:00:00.000Z');
function n(v) { return Number(v || 0); }

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: 'Core Integration V3 Smoke', subdomain: `core-v3-${suffix}`, nicho: 'ERP', pais: 'CO', moneda: 'COP', activo: true } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Core V3', email: `admin-v3-${suffix}@test.local`, password: 'not-used', rol: 'ADMIN', activo: true } });
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));
  await integration.ensureIntegrationDefaults(tenant.id);

  const parametrization = await integration.getParametrization(tenant.id);
  assert.equal(parametrization.parametros.filter((x) => x.configurado).length, parametrization.parametros.length, 'Todas las claves V3 deben tener default operativo');
  assert.equal(parametrization.config.metodoCosteo, 'PROMEDIO_PONDERADO');

  const accounts = Object.fromEntries((await prisma.cuentaPUC.findMany({ where: { tenantId: tenant.id } })).map((x) => [x.codigo, x]));
  const bank = await treasury.createCajaBanco(tenant.id, { tipo: 'BANCO', codigo: `B-${suffix}`, nombre: 'Banco Integración V3', banco: 'Banco QA', numeroCuenta: suffix, cuentaContableId: accounts['111005'].id, saldoActual: 1000000, activo: true });
  const cash = await treasury.createCajaBanco(tenant.id, { tipo: 'CAJA', codigo: `C-${suffix}`, nombre: 'Caja Integración V3', cuentaContableId: accounts['110505'].id, saldoActual: 0, activo: true });

  const supplier = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'PROVEEDOR', tipoDocumento: 'NIT', identificacion: `SUP-${suffix}`, nombre: 'Proveedor V3', razonSocial: 'Proveedor V3 SAS', cupoCredito: 5000000, diasPlazo: 30, responsableIva: true, sujetoRetefuente: false, activo: true } });
  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `CLI-${suffix}`, nombre: 'Cliente V3', cupoCredito: 5000000, diasPlazo: 30, activo: true } });
  await integration.updateThirdPartyExtended(tenant.id, supplier.id, { cupoCredito: 5000000, diasPlazo: 30, operacion: { condicionPagoDefault: 'CREDITO_30', responsableRetener: false } });
  await integration.updateThirdPartyExtended(tenant.id, customer.id, { cupoCredito: 5000000, diasPlazo: 30, operacion: { condicionPagoDefault: 'CREDITO_30', responsableRetener: false } });

  const product = await inventory.createProduct(tenant.id, { tipo: 'PRODUCTO', sku: `SKU-${suffix}`, nombre: 'Mercancía V3', controlaInventario: true, stockActual: 0, costoPromedio: 0, precio1: 200, ivaPct: 19, impoconsumoPct: 0, activo: true });

  // 1–2. Proveedor + compra a crédito => Kardex + CxP + AU.
  await integration.preflightCommercialInput(tenant.id, 'COMPRA', { estado: 'EMITIDO', terceroId: supplier.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ productoId: product.id, cantidad: 10, precioUnitario: 100, ivaPct: 19 }] });
  const purchase = await commercial.createDocument(tenant.id, user.id, { tipo: 'COMPRA', estado: 'EMITIDO', terceroId: supplier.id, formaPago: 'CREDITO', fecha: DATE, fechaVencimiento: new Date('2026-09-09T12:00:00.000Z'), detalles: [{ productoId: product.id, cantidad: 10, precioUnitario: 100, ivaPct: 19 }] });
  assert.equal(purchase.estado, 'EMITIDO');
  assert.equal(n(purchase.total), 1190);
  assert.equal(n(purchase.saldo), 1190);
  assert.equal(n(purchase.detalles[0].producto.stockActual), 10);
  assert.ok(purchase.asiento?.numeroComprobante?.startsWith('AU-'), 'Compra debe generar AU');
  assert.equal(n(purchase.asiento.totalDebito), n(purchase.asiento.totalCredito));
  assert.equal(n(purchase.cartera?.saldo), 1190);

  // 3. Pago parcial proveedor => Proveedores / Banco y CxP actualizada.
  const supplierPayment = await treasury.registerPayment(tenant.id, user.id, { documentoId: purchase.id, cajaBancoId: bank.id, metodoPago: 'TRANSFERENCIA', monto: 500, referencia: 'PAGO-PARCIAL-V3', sourceId: `pay-${suffix}` });
  assert.equal(n(supplierPayment.cartera.saldo), 690);
  assert.ok(supplierPayment.comprobanteTesoreria.asiento.numeroComprobante.startsWith('AU-'));
  assert.equal(n(supplierPayment.comprobanteTesoreria.asiento.totalDebito), n(supplierPayment.comprobanteTesoreria.asiento.totalCredito));

  // 4–5. Cliente + venta a crédito => Ingreso/IVA + costo/inventario en AU y salida Kardex.
  await integration.preflightCommercialInput(tenant.id, 'FACTURA_VENTA', { estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ productoId: product.id, cantidad: 4, precioUnitario: 200, ivaPct: 19 }] });
  const sale = await commercial.createDocument(tenant.id, user.id, { tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, fechaVencimiento: new Date('2026-09-09T12:00:00.000Z'), detalles: [{ productoId: product.id, cantidad: 4, precioUnitario: 200, ivaPct: 19 }] });
  assert.equal(n(sale.total), 952);
  assert.equal(n(sale.cartera.saldo), 952);
  assert.ok(sale.asiento.numeroComprobante.startsWith('AU-'));
  assert.equal(n(sale.asiento.totalDebito), n(sale.asiento.totalCredito));
  assert.ok(sale.asiento.detalles.some((x) => x.cuenta.codigo === '613505' && n(x.debito) === 400), 'Debe reconocer costo de venta');
  assert.ok(sale.asiento.detalles.some((x) => x.cuenta.codigo === '143505' && n(x.credito) === 400), 'Debe acreditar inventario');
  assert.equal(n((await inventory.getProduct(tenant.id, product.id)).stockActual), 6);

  // 6. Recaudo total del cliente.
  const receipt = await treasury.registerPayment(tenant.id, user.id, { documentoId: sale.id, cajaBancoId: bank.id, metodoPago: 'TRANSFERENCIA', monto: 952, referencia: 'RECAUDO-V3', sourceId: `collect-${suffix}` });
  assert.equal(n(receipt.cartera.saldo), 0);
  assert.ok(receipt.comprobanteTesoreria.asiento.numeroComprobante.startsWith('AU-'));

  // Tesorería: transferencia patrimonial + gasto directo.
  const transfer = await integration.transferOwnFunds(tenant.id, user.id, { origenId: bank.id, destinoId: cash.id, monto: 100, fecha: DATE, referencia: `TRF-${suffix}`, concepto: 'Banco a Caja QA' });
  assert.equal(n(transfer.asiento.totalDebito), 100);
  assert.equal(n(transfer.asiento.totalCredito), 100);
  const directExpense = await integration.directExpense(tenant.id, user.id, { cajaBancoId: cash.id, cuentaGastoId: accounts['519595'].id, monto: 25, fecha: DATE, concepto: 'Gasto directo QA V3' });
  assert.ok(directExpense.asiento.numeroComprobante.startsWith('AU-'));

  // Ajuste faltante con soporte obligatorio => Kardex + AU + soporte.
  await assert.rejects(() => integration.createInventoryAdjustment(tenant.id, user.id, { productoId: product.id, tipo: 'FALTANTE', cantidad: 1, justificacion: 'Faltante QA sin soporte' }), (e) => e.code === 'INVENTORY_ADJUSTMENT_SUPPORT_REQUIRED');
  const adjustment = await integration.createInventoryAdjustment(tenant.id, user.id, { productoId: product.id, tipo: 'FALTANTE', cantidad: 1, justificacion: 'Conteo físico de control QA', soporte: { nombre: 'conteo.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 QA').toString('base64') } });
  assert.ok(adjustment.asiento.numeroComprobante.startsWith('AU-'));
  assert.ok(adjustment.soporte?.hashSha256);
  assert.equal(n((await inventory.getProduct(tenant.id, product.id)).stockActual), 5);

  // Método PEPS parametrizable: 2 entradas a costos distintos y salida consume primera capa.
  await runtime.updateIntegrationConfig(tenant.id, { metodoCosteo: 'PEPS' });
  const fifo = await inventory.createProduct(tenant.id, { tipo: 'PRODUCTO', sku: `FIFO-${suffix}`, nombre: 'Producto PEPS', controlaInventario: true, stockActual: 0, costoPromedio: 0, precio1: 50, ivaPct: 0, impoconsumoPct: 0, activo: true });
  await prisma.$transaction((tx) => inventory.applyMovement(tx, { tenantId: tenant.id, productoId: fifo.id, tipo: 'AJUSTE_ENTRADA', cantidad: 2, costoUnitario: 10, referencia: 'FIFO-1' }));
  await prisma.$transaction((tx) => inventory.applyMovement(tx, { tenantId: tenant.id, productoId: fifo.id, tipo: 'AJUSTE_ENTRADA', cantidad: 2, costoUnitario: 20, referencia: 'FIFO-2' }));
  const fifoExit = await prisma.$transaction((tx) => inventory.applyMovement(tx, { tenantId: tenant.id, productoId: fifo.id, tipo: 'AJUSTE_SALIDA', cantidad: 3, referencia: 'FIFO-OUT' }));
  assert.equal(fifoExit.metodoCosteo, 'PEPS');
  assert.equal(n(fifoExit.costOfMovement), 40, 'PEPS: 2×10 + 1×20');
  assert.equal(n(fifoExit.product.stockActual), 1);

  // Retención automática de compra: total bruto 119, CxP neta 116.50.
  const retentionTemplate = (await taxes.listRetentions(tenant.id)).find((x) => x.codigo === 'RTF-COMPRAS');
  await taxes.upsertRetention(tenant.id, user.id, { codigo: retentionTemplate.codigo, nombre: retentionTemplate.nombre, tipo: 'RETEFUENTE', porcentaje: 2.5, baseMinima: 0, cuentaId: retentionTemplate.cuentaId, naturaleza: 'PAGAR', automatico: true, activo: true }, retentionTemplate.id);
  await prisma.tercero.update({ where: { id: supplier.id }, data: { sujetoRetefuente: true } });
  const retainedPurchase = await commercial.createDocument(tenant.id, user.id, { tipo: 'COMPRA', estado: 'EMITIDO', terceroId: supplier.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ descripcion: 'Servicio con retención', cantidad: 1, precioUnitario: 100, ivaPct: 19 }] });
  assert.equal(n(retainedPurchase.total), 119);
  assert.equal(n(retainedPurchase.retencionTotal), 2.5);
  assert.equal(n(retainedPurchase.cartera.saldo), 116.5);
  assert.ok(retainedPurchase.asiento.detalles.some((x) => x.conceptoRetencionId));

  // Aplicación múltiple atómica: dos ventas del mismo cliente y un solo comando.
  const saleA = await commercial.createDocument(tenant.id, user.id, { tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ descripcion: 'Servicio A', cantidad: 1, precioUnitario: 30, ivaPct: 0 }] });
  const saleB = await commercial.createDocument(tenant.id, user.id, { tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ descripcion: 'Servicio B', cantidad: 1, precioUnitario: 40, ivaPct: 0 }] });
  const multi = await integration.applyMultiplePayments(tenant.id, user.id, { tipo: 'CXC', cajaBancoId: bank.id, metodoPago: 'TRANSFERENCIA', fecha: DATE, aplicaciones: [{ documentoId: saleA.id, monto: 30 }, { documentoId: saleB.id, monto: 40 }] });
  assert.equal(multi.aplicaciones.length, 2);
  assert.ok(multi.aplicaciones.every((x) => Number(x.saldoNuevo) === 0 && /^AU-/.test(x.asiento)));

  // 7. Cartera y auxiliar usan los mismos detalles contables; reportes siguen cuadrados.
  const cartera = await integration.getCarteraSummary(tenant.id);
  assert.ok(cartera.terceros.some((x) => x.tercero.id === supplier.id));
  const supplierAux = await integration.getThirdPartyAccountingDetail(tenant.id, supplier.id, 'CXP');
  const supplierOpen = cartera.terceros.find((x) => x.tercero.id === supplier.id)?.CXP || 0;
  assert.ok(Math.abs(supplierAux.saldoAuxiliar - supplierOpen) < 0.01, `Auxiliar proveedor ${supplierAux.saldoAuxiliar} vs cartera ${supplierOpen}`);
  const trial = await accounting.getTrialBalance(tenant.id, { desde: '2026-08-01', hasta: '2026-08-31' });
  assert.ok(Math.abs(n(trial.totalDebito) - n(trial.totalCredito)) < 0.01, 'Balance de prueba debe cuadrar');
  const pnl = await accounting.getProfitAndLoss(tenant.id, { desde: '2026-08-01', hasta: '2026-08-31' });
  const bs = await accounting.getBalanceSheet(tenant.id, { corte: '2026-08-31' });
  assert.ok(Number.isFinite(n(pnl.utilidadNeta)));
  assert.ok(Math.abs(n(bs.diferencia)) < 0.01, `Balance general diferencia ${bs.diferencia}`);

  // Mapeo faltante bloquea antes del negocio y deja mensaje funcional.
  const salesMap = await prisma.mapeoContable.findUnique({ where: { tenantId_clave: { tenantId: tenant.id, clave: 'VENTAS' } } });
  await prisma.mapeoContable.delete({ where: { id: salesMap.id } });
  await assert.rejects(() => integration.preflightCommercialInput(tenant.id, 'FACTURA_VENTA', { estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ descripcion: 'Debe bloquear', cantidad: 1, precioUnitario: 1, ivaPct: 0 }] }), (e) => e.code === 'ACCOUNTING_MAPPING_REQUIRED' && /Configure la cuenta contable/.test(e.message));
  await integration.ensureIntegrationDefaults(tenant.id);

  // 8. Cierre de periodo y bloqueo transaccional en módulo origen sin efectos laterales.
  await governance.closePeriod(tenant.id, user.id, 2026, 8);
  const beforeDocs = await prisma.comprobanteComercial.count({ where: { tenantId: tenant.id, tipo: 'FACTURA_VENTA' } });
  await assert.rejects(() => commercial.createDocument(tenant.id, user.id, { tipo: 'FACTURA_VENTA', estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', fecha: DATE, detalles: [{ descripcion: 'Venta periodo cerrado', cantidad: 1, precioUnitario: 10, ivaPct: 0 }] }), (e) => e.code === 'ACCOUNTING_PERIOD_CLOSED');
  const afterDocs = await prisma.comprobanteComercial.count({ where: { tenantId: tenant.id, tipo: 'FACTURA_VENTA' } });
  assert.equal(afterDocs, beforeDocs, 'Periodo cerrado no debe dejar documento huérfano');

  // UI operacional: el overlay debe ser JavaScript válido y estar inyectado por app.
  const ui = fs.readFileSync(require.resolve('../src/web/core-integration-v3.js'), 'utf8');
  new Function(ui);
  assert.match(ui, /Parametrización contable única/);
  assert.match(ui, /Nueva compra/);
  assert.match(ui, /Ajuste de inventario/);
  assert.match(ui, /Aplicar pago \/ recaudo a cartera/);

  console.log('CORE ACCOUNTING INTEGRATION V3 SMOKE OK');
  console.log(JSON.stringify({
    tenant: tenant.subdomain,
    mappings: parametrization.parametros.length,
    purchaseAU: purchase.asiento.numeroComprobante,
    purchaseBalanceAfterPartialPayment: 690,
    saleAU: sale.asiento.numeroComprobante,
    stockAfterSaleAndShortage: 5,
    fifoCost3Units: 40,
    retainedPurchaseNetCxP: 116.5,
    multiApplications: multi.aplicaciones.length,
    trialBalanced: true,
    balanceSheetDifference: n(bs.diferencia),
    closedPeriodBlockedAtSource: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
