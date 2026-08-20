const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const inventory = require('../src/modules/inventory/inventory.service');
const dian = require('../src/modules/platform/dian/dian.service');
const edge = require('../src/modules/edge/edge.service');

function n(v) { return Number(v || 0); }

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Edge Offline QA ${stamp}`, subdomain: `edge-${stamp}`, nicho: 'CORE_QA', pais: 'CO', moneda: 'COP' } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Admin Edge QA', email: `admin-edge-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });
  await prisma.$transaction(async (tx) => { await seedTenantDefaults(tx, tenant); await seedPlatformDefaults(tx, tenant, admin); });

  await dian.saveConfig(tenant.id, admin.id, { providerCode: 'MOCK_PT', providerName: 'PT QA', environment: 'HABILITACION', invoiceEnabled: true, payrollEnabled: false, contingencyEnabled: true });
  await dian.saveNumberingRange(tenant.id, { documentType: 'DOCUMENTO_EQUIVALENTE_POS', prefix: 'EO', rangeFrom: 1, rangeTo: 9999, nextNumber: 1, authorizationNumber: `EDGE-QA-${stamp}`, active: true });
  await edge.saveOfflinePolicy(tenant.id, admin.id, { paymentPolicy: 'MANUAL_EXTERNAL_PENDING', manualPaymentNote: 'Conserve voucher para conciliación.' });

  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'CC', identificacion: `EDGECLI-${stamp}`, nombre: 'Consumidor Edge QA' } });
  const cash = await prisma.cajaBanco.findFirst({ where: { tenantId: tenant.id, tipo: 'CAJA', activo: true } });
  assert.ok(cash);
  const product = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `EDGE-P-${stamp}`, nombre: 'Último ítem QA', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 0, stockActual: 0, precio1: 10000, ivaPct: 0, impoconsumoPct: 0, activo: true } });
  const manualProduct = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'PRODUCTO', sku: `EDGE-M-${stamp}`, nombre: 'Cobro externo QA', unidadMedida: 'UND', controlaInventario: true, costoPromedio: 0, stockActual: 0, precio1: 5000, ivaPct: 0, impoconsumoPct: 0, activo: true } });
  await prisma.$transaction(async (tx) => {
    await inventory.applyMovement(tx, { tenantId: tenant.id, productoId: product.id, tipo: 'COMPRA', cantidad: 1, costoUnitario: 4000, referencia: 'EDGE-SEED' });
    await inventory.applyMovement(tx, { tenantId: tenant.id, productoId: manualProduct.id, tipo: 'COMPRA', cantidad: 2, costoUnitario: 2000, referencia: 'EDGE-MANUAL-SEED' });
  });

  const provisionA = await edge.provisionAgent(tenant.id, admin.id, { name: 'Caja Offline A', pointCode: 'CAJA-A', defaultCustomerId: customer.id, defaultCashAccountId: cash.id });
  const provisionB = await edge.provisionAgent(tenant.id, admin.id, { name: 'Caja Offline B', pointCode: 'CAJA-B', defaultCustomerId: customer.id, defaultCashAccountId: cash.id });
  assert.ok(provisionA.edgeKey && provisionB.edgeKey);
  const agentA = await edge.authenticateAgent(provisionA.id, provisionA.edgeKey);
  const agentB = await edge.authenticateAgent(provisionB.id, provisionB.edgeKey);
  const snapshotA = await edge.buildBootstrap(agentA);
  const snapshotB = await edge.buildBootstrap(agentB);
  assert.equal(snapshotA.products.find((p) => p.id === product.id).stockActual, 1);
  assert.equal(snapshotB.products.find((p) => p.id === product.id).stockActual, 1);
  assert.equal(snapshotA.offlinePolicy.paymentPolicy, 'MANUAL_EXTERNAL_PENDING');
  assert.match(snapshotA.offlinePolicy.manualPaymentNote, /voucher/i);

  const makeOp = (id, ts) => ({
    id,
    type: 'SALE_EMIT',
    localTimestamp: ts,
    payload: {
      terceroId: customer.id,
      cajaBancoId: cash.id,
      formaPago: 'EFECTIVO',
      paymentMode: 'CASH',
      paymentStatus: 'PAID_LOCAL',
      documentType: 'DOCUMENTO_EQUIVALENTE_POS',
      snapshotVersion: snapshotA.snapshotVersion,
      configurationFingerprint: snapshotA.configurationFingerprint,
      detalles: [{ productoId: product.id, descripcion: product.nombre, cantidad: 1, precioUnitario: 10000, descuentoPct: 0, ivaPct: 0, impoconsumoPct: 0 }]
    }
  });

  const first = await edge.processOperations(agentA, [makeOp(`OFF-A-${stamp}`, new Date(Date.now() - 2000).toISOString())]);
  assert.equal(first[0].ok, true);
  assert.equal(n((await prisma.producto.findUnique({ where: { id: product.id } })).stockActual), 0);

  await prisma.producto.update({ where: { id: product.id }, data: { precio1: 11000 } });
  const second = await edge.processOperations(agentB, [makeOp(`OFF-B-${stamp}`, new Date(Date.now() - 1000).toISOString())]);
  assert.equal(second[0].ok, true);

  const finalProduct = await prisma.producto.findUnique({ where: { id: product.id } });
  assert.equal(n(finalProduct.stockActual), -1);
  const negativeAlert = await prisma.edgeReconciliationAlert.findFirst({ where: { tenantId: tenant.id, edgeAgentId: agentB.id, type: 'NEGATIVE_STOCK', productoId: product.id } });
  assert.ok(negativeAlert);
  const driftAlert = await prisma.edgeReconciliationAlert.findFirst({ where: { tenantId: tenant.id, edgeAgentId: agentB.id, type: 'CONFIG_DRIFT', productoId: product.id } });
  assert.ok(driftAlert);

  // Cierre del ciclo CONFIG_DRIFT: revisar sin alterar retroactivamente la venta y auditar usuario/fecha.
  const reviewed = await edge.acknowledgeAlert(tenant.id, admin.id, driftAlert.id);
  assert.equal(reviewed.state, 'ACKNOWLEDGED');
  assert.equal(reviewed.acknowledgedById, admin.id);
  assert.ok(reviewed.acknowledgedAt);
  const audit = await prisma.rbacAudit.findFirst({ where: { tenantId: tenant.id, actorUserId: admin.id, action: 'EDGE_ALERT_ACKNOWLEDGED' }, orderBy: { creadoEn: 'desc' } });
  assert.ok(audit);
  assert.equal(audit.metadata.edgeAlertId, driftAlert.id);
  assert.equal(audit.metadata.decision, 'REVIEWED_NO_ACTION');

  // Política B: el Edge registra un datáfono/QR externo sin simular autorización. Centraliza como CxC pendiente.
  const manualOperation = {
    id: `OFF-MANUAL-${stamp}`,
    type: 'SALE_EMIT',
    localTimestamp: new Date().toISOString(),
    payload: {
      terceroId: customer.id,
      cajaBancoId: null,
      formaPago: 'CREDITO',
      paymentMode: 'MANUAL_EXTERNAL_PENDING',
      paymentStatus: 'PENDING_CONFIRMATION',
      documentType: 'DOCUMENTO_EQUIVALENTE_POS',
      snapshotVersion: snapshotA.snapshotVersion,
      configurationFingerprint: snapshotA.configurationFingerprint,
      detalles: [{ productoId: manualProduct.id, descripcion: manualProduct.nombre, cantidad: 1, precioUnitario: 5000, descuentoPct: 0, ivaPct: 0, impoconsumoPct: 0 }]
    }
  };
  const manualResult = await edge.processOperations(agentA, [manualOperation]);
  assert.equal(manualResult[0].ok, true);
  const manualSale = await prisma.comprobanteComercial.findFirst({
    where: { tenantId: tenant.id, sourceId: `EDGE-${agentA.id}-${manualOperation.id}` },
    include: { cartera: true, movimientosTesoreria: true, asiento: true }
  });
  assert.ok(manualSale);
  assert.equal(manualSale.formaPago, 'CREDITO');
  assert.equal(manualSale.movimientosTesoreria.length, 0);
  assert.equal(manualSale.cartera.length, 1);
  assert.equal(manualSale.cartera[0].tipo, 'CXC');
  assert.equal(n(manualSale.cartera[0].saldo), 5000);
  assert.ok(manualSale.asiento);

  const sales = await prisma.comprobanteComercial.findMany({ where: { tenantId: tenant.id, tipo: 'FACTURA_VENTA', sourceId: { startsWith: 'EDGE-' } }, include: { asiento: true } });
  assert.equal(sales.length, 3);
  assert.ok(sales.every((s) => s.estado === 'EMITIDO' && s.asiento?.estado === 'CONTABILIZADO'));
  assert.equal(await prisma.dianDocument.count({ where: { tenantId: tenant.id, originType: 'COMPROBANTE_COMERCIAL', originId: { in: sales.map((s) => s.id) } } }), 3);
  assert.equal(await prisma.edgeSyncReceipt.count({ where: { tenantId: tenant.id, state: 'SYNCED' } }), 3);

  await edge.revokeAgent(tenant.id, admin.id, agentB.id);
  let revokedError = null;
  try { await edge.authenticateAgent(agentB.id, provisionB.edgeKey); } catch (error) { revokedError = error; }
  assert.equal(revokedError?.code, 'EDGE_AUTH_INVALID');
  const stillActive = await edge.authenticateAgent(agentA.id, provisionA.edgeKey);
  assert.equal(stillActive.id, agentA.id);

  console.log('EDGE OFFLINE-FIRST CENTRAL RECONCILIATION + CLOSURE SMOKE OK');
  console.log(JSON.stringify({
    twoOfflinePointsKeptSales: true,
    finalStock: n(finalProduct.stockActual),
    negativeStockAlert: true,
    configurationDriftAlert: true,
    configDriftReviewedAndAudited: true,
    offlinePaymentPolicy: snapshotA.offlinePolicy.paymentPolicy,
    manualExternalCreatesPendingCxC: true,
    accountingAU: sales.every((s) => Boolean(s.asiento)),
    dianOutbox: 3,
    deviceRevocationIsolated: true
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
