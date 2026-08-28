'use strict';

const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const dian = require('../src/modules/platform/dian/dian.service');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  if (!admin) throw new Error('Administrador demo no encontrado');

  await dian.saveConfig(demo.tenantId, admin.id, {
    providerCode: 'MOCK_PT',
    providerName: 'Stress Lab Mock PT',
    environment: 'HABILITACION',
    habilitacionBaseUrl: null,
    produccionBaseUrl: null,
    certificateAlias: null,
    certificateExpiresAt: null,
    certificateFingerprint: null,
    invoiceEnabled: true,
    payrollEnabled: false,
    contingencyEnabled: true,
    habilitacionChecklist: { stressLab: true }
  });

  await dian.saveNumberingRange(demo.tenantId, {
    documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    prefix: 'ST',
    rangeFrom: 1,
    rangeTo: 1000000,
    nextNumber: 1,
    authorizationNumber: 'STRESS-LAB-NO-FISCAL',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2030-12-31T23:59:59.999Z'),
    active: true
  });

  console.log(`STRESS_DIAN_READY tenant=${demo.tenantId} mode=HABILITACION document=DOCUMENTO_EQUIVALENTE_POS`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
