const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const accounting = require('../src/modules/accounting/accounting.service');
const numbering = require('../src/modules/accounting/accounting-numbering.service');
const governance = require('../src/modules/accounting/accounting-governance.service');
const taxes = require('../src/modules/accounting/accounting-tax.service');
const fixedAssets = require('../src/modules/accounting/fixed-assets.service');
const reconciliation = require('../src/modules/accounting/bank-reconciliation.service');
const supports = require('../src/modules/accounting/accounting-supports.service');
const exporter = require('../src/modules/accounting/accounting-export.service');
const treasury = require('../src/modules/treasury/treasury.service');

const DATE = new Date('2026-08-15T12:00:00.000Z');
const CUTOFF = '2026-08-31';

function n(v) { return Number(v || 0); }

async function account(tenantId, codigo) {
  const row = await prisma.cuentaPUC.findUnique({ where: { tenantId_codigo: { tenantId, codigo } } });
  assert.ok(row, `Falta cuenta ${codigo}`);
  return row;
}

async function post(tenantId, userId, concepto, detalles, extra = {}) {
  return accounting.createManualJournal(tenantId, userId, {
    fecha: DATE,
    concepto,
    tipoComprobanteId: extra.tipoComprobanteId || null,
    referenciaExterna: extra.referenciaExterna || null,
    detalles
  });
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tenant = await prisma.tenant.create({
    data: { nombreEmpresa: 'Accounting V2 Smoke', subdomain: `acct-v2-${suffix}`, nicho: 'ERP', pais: 'CO', moneda: 'COP', activo: true }
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, nombre: 'Admin V2', email: `admin-${suffix}@test.local`, password: 'not-used-in-service-test', rol: 'ADMIN', activo: true }
  });
  await prisma.$transaction((tx) => seedTenantDefaults(tx, tenant));

  const [voucherTypes, vatRates, retentions, config] = await Promise.all([
    numbering.listVoucherTypes(prisma, tenant.id),
    taxes.listVatRates(tenant.id),
    taxes.listRetentions(tenant.id),
    governance.getConfig(tenant.id)
  ]);
  assert.ok(voucherTypes.length >= 10, 'Debe sembrar tipos de comprobante');
  assert.ok(vatRates.some((x) => x.codigo === 'IVA19'));
  assert.ok(retentions.some((x) => x.codigo === 'RTF-COMPRAS'));
  assert.ok(config?.cuentaUtilidadEjercicioId && config?.cuentaPerdidaEjercicioId);

  const [cash, bankAccount, inventory, fixedAccount, accumDep, sales, vatGen, vatDed, cogs, adminExpense, salesExpense, nonopIncome, nonopExpense, depExpense, capitalParent] = await Promise.all([
    account(tenant.id, '110505'), account(tenant.id, '111005'), account(tenant.id, '143505'), account(tenant.id, '152405'), account(tenant.id, '159215'),
    account(tenant.id, '413505'), account(tenant.id, '240801'), account(tenant.id, '240802'), account(tenant.id, '613505'), account(tenant.id, '519595'),
    account(tenant.id, '529595'), account(tenant.id, '429505'), account(tenant.id, '530505'), account(tenant.id, '516015'), account(tenant.id, '3105')
  ]);

  const capital = await accounting.createAccount(tenant.id, {
    codigo: '31050599', nombre: 'Capital prueba V2', nivel: 'AUXILIAR', naturaleza: 'CREDITO', parentId: capitalParent.id,
    permiteMovimiento: true, requiereTercero: false, clasificacionESF: 'PATRIMONIO', categoriaResultado: null, activa: true
  }, user.id);

  const setup = await post(tenant.id, user.id, 'Aporte inicial y saldos de apertura', [
    { cuentaId: cash.id, debito: 100000, credito: 0 },
    { cuentaId: inventory.id, debito: 40000, credito: 0 },
    { cuentaId: fixedAccount.id, debito: 120000, credito: 0 },
    { cuentaId: capital.id, debito: 0, credito: 260000 }
  ]);
  assert.match(setup.numeroComprobante, /^CA-202608-\d{6}$/);

  await post(tenant.id, user.id, 'Venta gravada', [
    { cuentaId: cash.id, debito: 119000, credito: 0 },
    { cuentaId: sales.id, debito: 0, credito: 100000 },
    { cuentaId: vatGen.id, debito: 0, credito: 19000 }
  ]);
  await post(tenant.id, user.id, 'Costo de venta', [
    { cuentaId: cogs.id, debito: 40000, credito: 0 },
    { cuentaId: inventory.id, debito: 0, credito: 40000 }
  ]);
  await post(tenant.id, user.id, 'Gasto administrativo', [
    { cuentaId: adminExpense.id, debito: 20000, credito: 0 },
    { cuentaId: cash.id, debito: 0, credito: 20000 }
  ]);
  await post(tenant.id, user.id, 'Gasto de ventas', [
    { cuentaId: salesExpense.id, debito: 10000, credito: 0 },
    { cuentaId: cash.id, debito: 0, credito: 10000 }
  ]);
  await post(tenant.id, user.id, 'Ingreso no operacional', [
    { cuentaId: cash.id, debito: 5000, credito: 0 },
    { cuentaId: nonopIncome.id, debito: 0, credito: 5000 }
  ]);
  await post(tenant.id, user.id, 'Gasto no operacional', [
    { cuentaId: nonopExpense.id, debito: 3000, credito: 0 },
    { cuentaId: cash.id, debito: 0, credito: 3000 }
  ]);

  const third = await prisma.tercero.create({
    data: {
      tenantId: tenant.id, tipo: 'OTRO', tipoDocumento: 'NIT', identificacion: `900${Date.now()}`,
      nombre: 'Tercero fiscal V2', razonSocial: 'Tercero fiscal V2 SAS', responsableIva: true,
      sujetoRetefuente: true, sujetoReteIca: false, sujetoReteIva: false, activo: true
    }
  });
  const retentionTemplate = retentions.find((x) => x.codigo === 'RTF-COMPRAS');
  const activeRetention = await taxes.upsertRetention(tenant.id, user.id, {
    codigo: retentionTemplate.codigo,
    nombre: retentionTemplate.nombre,
    tipo: retentionTemplate.tipo,
    porcentaje: 2.5,
    baseMinima: 0,
    cuentaId: retentionTemplate.cuentaId,
    naturaleza: 'PAGAR',
    automatico: true,
    activo: true
  }, retentionTemplate.id);
  const iva19 = vatRates.find((x) => x.codigo === 'IVA19');
  const calc = await taxes.calculateTaxes(tenant.id, { terceroId: third.id, tipoOperacion: 'COMPRA', base: 100000, tarifaIvaId: iva19.id });
  assert.equal(n(calc.iva.valor), 19000);
  assert.equal(n(calc.totalRetenciones), 2500);
  assert.equal(calc.retenciones.length, 1);

  await post(tenant.id, user.id, 'Compra/gasto con IVA y retención', [
    { cuentaId: adminExpense.id, terceroId: third.id, debito: 100000, credito: 0 },
    { cuentaId: vatDed.id, terceroId: third.id, tarifaIvaId: iva19.id, debito: calc.iva.valor, credito: 0 },
    { cuentaId: activeRetention.cuentaId, terceroId: third.id, conceptoRetencionId: activeRetention.id, debito: 0, credito: calc.totalRetenciones },
    { cuentaId: cash.id, terceroId: third.id, debito: 0, credito: 116500 }
  ]);

  let pnl = await accounting.getProfitAndLoss(tenant.id, { desde: '2026-08-01', hasta: CUTOFF, comparar: true });
  assert.equal(n(pnl.ingresosOperacionales), 100000);
  assert.equal(n(pnl.costoVentas), 40000);
  assert.equal(n(pnl.utilidadBruta), 60000);
  assert.equal(n(pnl.gastosAdministracion), 120000);
  assert.equal(n(pnl.gastosVentas), 10000);
  assert.equal(n(pnl.utilidadOperacional), -70000);
  assert.equal(n(pnl.ingresosNoOperacionales), 5000);
  assert.equal(n(pnl.gastosNoOperacionales), 3000);
  assert.equal(n(pnl.utilidadAntesImpuestos), -68000);
  assert.equal(n(pnl.utilidadNeta), -68000);
  assert.ok(pnl.comparativo);

  let bs = await accounting.getBalanceSheet(tenant.id, { corte: CUTOFF, comparar: true });
  assert.equal(bs.cuadra, true, `Balance General no cuadra: ${bs.diferencia}`);
  assert.equal(n(bs.diferencia), 0);
  assert.equal(n(bs.utilidadEjercicioNoCerrada), -68000);
  assert.ok(bs.comparativo);

  const customType = await numbering.createVoucherType(prisma, tenant.id, { codigo: 'XX', nombre: 'Transferencia de prueba', consecutivoPorPeriodo: true, activo: true });
  const draft = await accounting.createDraftManualJournal(tenant.id, user.id, {
    fecha: DATE,
    concepto: 'Borrador transferencia',
    tipoComprobanteId: customType.id,
    detalles: [
      { cuentaId: bankAccount.id, debito: 10000, credito: 0 },
      { cuentaId: cash.id, debito: 0, credito: 10000 }
    ]
  });
  assert.equal(draft.numeroComprobante, null, 'Borrador no debe consumir consecutivo');
  const posted = await accounting.postDraftJournal(tenant.id, user.id, draft.id);
  assert.match(posted.numeroComprobante, /^XX-202608-000001$/);
  const reversal = await accounting.reverseJournal(tenant.id, user.id, posted.id, 'Prueba de reversión');
  assert.match(reversal.numeroComprobante, /^RV-202608-\d{6}$/);
  const originalAfter = await prisma.asientoContable.findUnique({ where: { id: posted.id } });
  assert.equal(originalAfter.estado, 'ANULADO');
  const journalDetail = await accounting.getJournal(tenant.id, posted.id);
  assert.ok(journalDetail.auditoria.some((x) => x.accion === 'ANULAR'));

  const trial = await accounting.getTrialBalance(tenant.id, { desde: '2026-08-01', hasta: CUTOFF, comparar: true });
  assert.equal(trial.cuadra, true);
  assert.equal(n(trial.diferencia), 0);

  const asset = await fixedAssets.createAsset(tenant.id, user.id, {
    codigo: `AF-${Date.now()}`, nombre: 'Equipo oficina V2', terceroId: third.id, valorAdquisicion: 120000, valorResidual: 0,
    fechaCompra: new Date('2026-08-01T00:00:00.000Z'), fechaInicioDepreciacion: new Date('2026-08-01T00:00:00.000Z'), vidaUtilMeses: 12,
    cuentaActivoId: fixedAccount.id, cuentaDepAcumuladaId: accumDep.id, cuentaGastoDepreciacionId: depExpense.id
  });
  const dep = await fixedAssets.generateDepreciation(tenant.id, user.id, asset.id, 2026, 8);
  assert.equal(n(dep.valor), 10000);
  assert.equal(n(dep.asiento.totalDebito), n(dep.asiento.totalCredito));
  assert.match(dep.asiento.numeroComprobante, /^DP-202608-\d{6}$/);

  pnl = await accounting.getProfitAndLoss(tenant.id, { desde: '2026-08-01', hasta: CUTOFF });
  assert.equal(n(pnl.utilidadNeta), -78000);
  bs = await accounting.getBalanceSheet(tenant.id, { corte: CUTOFF });
  assert.equal(bs.cuadra, true, `Balance con depreciación no cuadra: ${bs.diferencia}`);
  assert.equal(n(bs.utilidadEjercicioNoCerrada), -78000);

  const closed = await governance.closePeriod(tenant.id, user.id, 2026, 8);
  assert.equal(closed.periodo.estado, 'CERRADO');
  assert.ok(closed.asientoCierre);
  assert.match(closed.asientoCierre.numeroComprobante, /^CC-202608-\d{6}$/);
  assert.equal(n(closed.asientoCierre.totalDebito), n(closed.asientoCierre.totalCredito));

  let blocked = false;
  try {
    await post(tenant.id, user.id, 'Debe bloquearse', [
      { cuentaId: cash.id, debito: 1, credito: 0 },
      { cuentaId: capital.id, debito: 0, credito: 1 }
    ]);
  } catch (error) {
    blocked = error.code === 'ACCOUNTING_PERIOD_CLOSED';
  }
  assert.equal(blocked, true, 'Periodo cerrado debe bloquear nuevas contabilizaciones');

  const bsClosed = await accounting.getBalanceSheet(tenant.id, { corte: CUTOFF });
  assert.equal(bsClosed.cuadra, true);
  assert.equal(n(bsClosed.utilidadEjercicioNoCerrada), 0, 'En periodo cerrado la utilidad ya está trasladada a patrimonio');

  const reopened = await governance.reopenPeriod(tenant.id, user.id, 'ADMIN', 2026, 8);
  assert.equal(reopened.periodo.estado, 'ABIERTO');
  assert.ok(reopened.reversoCierre);
  assert.equal(reopened.reversoCierre.origen, 'CIERRE');
  pnl = await accounting.getProfitAndLoss(tenant.id, { desde: '2026-08-01', hasta: CUTOFF });
  assert.equal(n(pnl.utilidadNeta), -78000, 'Reapertura no debe duplicar P&G');
  bs = await accounting.getBalanceSheet(tenant.id, { corte: CUTOFF });
  assert.equal(bs.cuadra, true);
  assert.equal(n(bs.utilidadEjercicioNoCerrada), -78000);

  const reclosed = await governance.closePeriod(tenant.id, user.id, 2026, 8);
  assert.notEqual(reclosed.asientoCierre.id, closed.asientoCierre.id, 'Re-cierre debe crear nuevo asiento trazable');

  const support = await supports.addSupport(tenant.id, user.id, setup.id, {
    nombre: 'soporte-prueba.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4\nVantixGC\n%%EOF').toString('base64')
  });
  assert.ok(support.hashSha256 && support.tamano > 0);
  const loadedSupport = await supports.getSupport(tenant.id, support.id);
  assert.equal(loadedSupport.mimeType, 'application/pdf');

  const bank = await prisma.cajaBanco.create({
    data: { tenantId: tenant.id, tipo: 'BANCO', nombre: `Banco V2 ${suffix}`, banco: 'Banco Demo', numeroCuenta: '001', cuentaContableId: bankAccount.id, saldoActual: 0, activo: true }
  });
  const movement = await prisma.$transaction((tx) => treasury.recordTreasuryMovementInTx(tx, {
    tenantId: tenant.id, userId: user.id, cajaBancoId: bank.id, tipo: 'INGRESO', monto: 50000, sign: 1, referencia: 'EXT-001', concepto: 'Ingreso bancario conciliable'
  }));
  const rec = await reconciliation.createReconciliation(tenant.id, user.id, {
    cajaBancoId: bank.id, fechaCorte: new Date('2026-08-31T23:59:59.000Z'), saldoExtracto: 50000,
    partidas: [{ fecha: new Date('2026-08-20T00:00:00.000Z'), descripcion: 'Ingreso bancario', referencia: 'EXT-001', tipo: 'DEBITO', valor: 50000 }]
  });
  const entry = rec.partidas[0];
  await reconciliation.matchEntry(tenant.id, user.id, rec.id, entry.id, movement.movement.id);
  const recClosed = await reconciliation.closeReconciliation(tenant.id, user.id, rec.id);
  assert.equal(recClosed.conciliadas, 1);
  assert.equal(recClosed.pendientes, 0);
  assert.equal(n(recClosed.diferencia), 0);

  const xls = await exporter.exportReport(tenant.id, 'balance-prueba', 'xls', { desde: '2026-08-01', hasta: CUTOFF });
  assert.ok(xls.buffer.length > 100 && xls.buffer.toString('utf8').includes('Balance de Prueba'));
  const pdf = await exporter.exportReport(tenant.id, 'estado-resultados', 'pdf', { desde: '2026-08-01', hasta: CUTOFF });
  assert.ok(pdf.buffer.subarray(0, 8).toString('binary').startsWith('%PDF-1.4'));

  console.log('ACCOUNTING CORE V2 SMOKE OK');
  console.log(JSON.stringify({
    voucherTypes: voucherTypes.length,
    vatRates: vatRates.length,
    partidaDoble: true,
    balanceGeneral: true,
    pnlCompleto: true,
    consecutivos: true,
    reversos: true,
    cierreReapertura: true,
    terceros: true,
    retencionesConfigurables: true,
    depreciacion: true,
    conciliacion: true,
    soportes: true,
    exportaciones: true
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
