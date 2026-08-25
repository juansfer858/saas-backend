const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const entitlements = require('../src/modules/platform/verticals/vertical-entitlement.service');

async function main() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Vertical Smoke ${suffix}`,
      subdomain: `vertical-smoke-${suffix}`,
      nicho: 'RESTAURANTE',
      pais: 'CO',
      moneda: 'COP',
      activo: true
    }
  });

  try {
    const migrated = await entitlements.ensureLegacyEntitlements(tenant.id);
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].verticalCode, 'RESTAURANT');
    assert.equal(migrated[0].state, 'ACTIVE');

    const manifest = await entitlements.edgeManifest(tenant.id);
    assert.equal(manifest.core.code, 'CORE');
    assert.equal(manifest.core.runtime, 'EDGE_UNIVERSAL_V1');
    assert.equal(manifest.verticals.length, 1);
    assert.equal(manifest.verticals[0].code, 'RESTAURANT');
    assert.equal(manifest.verticals[0].edgeAdapter, 'restaurant');
    assert.equal(manifest.verticals[0].edgeWorkspace, 'restaurant');

    await entitlements.suspend(tenant.id, 'RESTAURANT', { metadata: { test: true } });
    assert.equal(await entitlements.hasVertical(tenant.id, 'RESTAURANT'), false);
    assert.equal((await entitlements.edgeManifest(tenant.id)).verticals.length, 0);

    await entitlements.activate(tenant.id, 'RESTAURANTE', { source: 'SMOKE_REACTIVATE' });
    assert.equal(await entitlements.hasVertical(tenant.id, 'RESTAURANT'), true);

    let reservedError = null;
    try { await entitlements.activate(tenant.id, 'LITOGRAFIA'); }
    catch (error) { reservedError = error; }
    assert.ok(reservedError, 'Un vertical RESERVED no puede activarse');
    assert.equal(reservedError.code, 'VERTICAL_NOT_AVAILABLE');

    const rows = await entitlements.listTenantEntitlements(tenant.id, { ensureLegacy: false });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vertical.code, 'RESTAURANT');

    console.log('UNIVERSAL VERTICAL REGISTRY V1 POSTGRES SMOKE OK');
  } finally {
    await prisma.tenantVerticalEntitlement.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
