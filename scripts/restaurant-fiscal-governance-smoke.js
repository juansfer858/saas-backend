const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const platform = require('../src/modules/platform/saas/platform.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Restaurant Fiscal Governance ${stamp}`,
      subdomain: `rest-fiscal-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Admin Tenant QA',
      email: `tenant-${stamp}@example.com`,
      password: 'not-login',
      rol: 'ADMIN'
    }
  });
  const superAdmin = await prisma.platformSuperAdmin.create({
    data: {
      name: 'Super Admin Fiscal QA',
      email: `platform-${stamp}@example.com`,
      passwordHash: 'not-login',
      active: true
    }
  });

  const initial = await platform.getRestaurantFiscalGovernance(tenant.id);
  assert.equal(initial.governance.accepted, false);
  assert.equal(initial.governance.managedBy, 'PLATFORM_SUPERADMIN_ONLY');

  let missingAck = null;
  try {
    await platform.setRestaurantSimulatedFiscalAcceptance(superAdmin.id, tenant.id, {
      accepted: true,
      reason: 'Autorización temporal QA con justificación suficiente',
      acknowledgedNoDianValidity: false
    });
  } catch (error) { missingAck = error; }
  assert.equal(missingAck?.code, 'PLATFORM_RESTAURANT_FISCAL_ACK_REQUIRED');

  const reason = 'Autorización controlada QA para validar gobernanza antes de producción real.';
  const accepted = await platform.setRestaurantSimulatedFiscalAcceptance(superAdmin.id, tenant.id, {
    accepted: true,
    reason,
    acknowledgedNoDianValidity: true
  });
  assert.equal(accepted.governance.accepted, true);
  assert.match(accepted.governance.warning, /NO tienen validez fiscal ante la DIAN/);
  assert.equal(accepted.governance.lastDecision.superAdminId, superAdmin.id);
  assert.equal(accepted.governance.lastDecision.reason, reason);
  assert.equal(accepted.governance.lastDecision.acknowledgedNoDianValidity, true);
  assert.ok(accepted.governance.lastDecision.decidedAt);

  const acceptAudit = await prisma.platformAudit.findFirst({
    where: { tenantId: tenant.id, action: 'RESTAURANT_SIMULATED_FISCAL_ACCEPT' },
    orderBy: { creadoEn: 'desc' }
  });
  assert.ok(acceptAudit);
  assert.equal(acceptAudit.superAdminId, superAdmin.id);
  assert.equal(acceptAudit.metadata.reason, reason);
  assert.equal(acceptAudit.metadata.acknowledgedNoDianValidity, true);
  assert.equal(acceptAudit.metadata.before, false);
  assert.equal(acceptAudit.metadata.after, true);

  const table = await prisma.restaurantTable.create({
    data: { tenantId: tenant.id, code: `M-${stamp}`, name: 'Mesa Fiscal QA' }
  });
  const sale = await prisma.comprobanteComercial.create({
    data: {
      tenantId: tenant.id,
      tipo: 'FACTURA_VENTA',
      numero: `FV-FISC-${stamp}`,
      estado: 'EMITIDO',
      creadoPorId: user.id,
      fecha: new Date(),
      emitidoEn: new Date(),
      subtotal: 10000,
      total: 10000,
      saldo: 0
    }
  });
  const session = await prisma.restaurantTableSession.create({
    data: {
      tenantId: tenant.id,
      tableId: table.id,
      saleId: sale.id,
      state: 'CERRADA',
      openedByUserId: user.id,
      closedByUserId: user.id,
      closedAt: new Date()
    }
  });
  const simulatedSnapshot = {
    label: 'DOCUMENTO EQUIVALENTE SIMULADO',
    fiscalAcceptance: false,
    reason: 'DIAN/PT real no habilitado en este tenant',
    saleNumber: sale.numero
  };
  const fiscal = await prisma.restaurantFiscalDocument.create({
    data: {
      tenantId: tenant.id,
      sessionId: session.id,
      saleId: sale.id,
      mode: 'SIMULATED',
      documentType: 'DOCUMENTO_EQUIVALENTE_POS',
      internalNumber: sale.numero,
      simulatedData: simulatedSnapshot
    }
  });

  const revokeReason = 'Revocación QA porque el tenant continuará únicamente con habilitación DIAN real.';
  const revoked = await platform.setRestaurantSimulatedFiscalAcceptance(superAdmin.id, tenant.id, {
    accepted: false,
    reason: revokeReason,
    acknowledgedNoDianValidity: false
  });
  assert.equal(revoked.governance.accepted, false);
  assert.equal(revoked.governance.simulatedDocumentsIssued, 1);

  await prisma.restaurantConfig.update({ where: { tenantId: tenant.id }, data: { dianRealEnabled: true } });
  const fiscalAfterDian = await prisma.restaurantFiscalDocument.findUnique({ where: { id: fiscal.id } });
  assert.equal(fiscalAfterDian.mode, 'SIMULATED');
  assert.equal(fiscalAfterDian.dianDocumentId, null);
  assert.deepEqual(fiscalAfterDian.simulatedData, simulatedSnapshot);

  const revokeAudit = await prisma.platformAudit.findFirst({
    where: { tenantId: tenant.id, action: 'RESTAURANT_SIMULATED_FISCAL_REVOKE' },
    orderBy: { creadoEn: 'desc' }
  });
  assert.ok(revokeAudit);
  assert.equal(revokeAudit.superAdminId, superAdmin.id);
  assert.equal(revokeAudit.metadata.reason, revokeReason);
  assert.equal(revokeAudit.metadata.before, true);
  assert.equal(revokeAudit.metadata.after, false);
  assert.equal(revokeAudit.metadata.simulatedDocumentsAlreadyIssued, 1);

  const listed = await platform.listTenants();
  const listedTenant = listed.find((x) => x.id === tenant.id);
  assert.ok(listedTenant);
  assert.equal(listedTenant.restaurantFiscalGovernance.accepted, false);
  assert.equal(listedTenant.restaurantFiscalGovernance.simulatedDocumentsIssued, 1);
  assert.equal(listedTenant.restaurantFiscalGovernance.documentsImmutable, true);

  console.log('RESTAURANT FISCAL GOVERNANCE POSTGRES SMOKE OK');
  console.log(JSON.stringify({
    platformOnlyGovernance: true,
    acceptanceRequiresWarningAck: true,
    acceptanceAudited: true,
    revocationAudited: true,
    actorRecorded: superAdmin.id,
    justificationRecorded: true,
    simulatedDocumentRemainsSimulatedAfterDian: true,
    simulatedDocumentsIssued: 1
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
