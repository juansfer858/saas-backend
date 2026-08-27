const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const zones = require('../src/modules/restaurant/restaurant-zones.service');
const qr = require('../src/modules/restaurant/restaurant-qr.service');
const { readRestaurantSchemaState } = require('./ensure-restaurant-runtime-schema');

async function main() {
  const schemaState = await readRestaurantSchemaState();
  assert.equal(schemaState.ready, true, 'Restaurant runtime schema readiness must include zones');
  assert.ok(schemaState.state.zone, 'RestaurantZone table must be part of runtime readiness');
  assert.equal(schemaState.state.tableZoneId, true, 'RestaurantTable.zoneId must be part of runtime readiness');

  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Restaurant Zones QA ${stamp}`,
      subdomain: `rest-zones-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });

  let auditUser = null;
  try {
    auditUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        nombre: 'Restaurant QR QA',
        email: `restaurant-qr-${stamp}@example.test`,
        password: 'qa-not-used',
        rol: 'ADMIN'
      }
    });

    // Simula un tenant existente antes de introducir zonas: mesa válida con zoneId null.
    const legacyTable = await restaurant.createTable(tenant.id, {
      code: 'M1', name: 'Mesa heredada', seats: 4, posX: 30, posY: 30
    });
    assert.equal(legacyTable.zoneId, null);

    const defaultZone = await zones.ensureDefaultZone(tenant.id);
    assert.equal(defaultZone.name, 'Salón principal');
    let stored = await prisma.restaurantTable.findUnique({ where: { id: legacyTable.id } });
    assert.equal(stored.zoneId, defaultZone.id, 'existing tables must be backfilled into the default zone');

    const terrace = await zones.createZone(tenant.id, { name: 'Terraza' });
    assert.equal(terrace.active, true);
    await zones.assignTable(tenant.id, legacyTable.id, terrace.id);
    stored = await prisma.restaurantTable.findUnique({ where: { id: legacyTable.id } });
    assert.equal(stored.zoneId, terrace.id);

    const listed = await zones.listZones(tenant.id);
    const terraceListed = listed.find((zone) => zone.id === terrace.id);
    assert.ok(terraceListed);
    assert.equal(terraceListed.tableCount, 1);

    await assert.rejects(
      () => zones.removeZone(tenant.id, terrace.id),
      (error) => error?.code === 'RESTAURANT_ZONE_HAS_TABLES'
    );

    await zones.assignTable(tenant.id, legacyTable.id, defaultZone.id);
    await zones.removeZone(tenant.id, terrace.id);
    const inactive = await prisma.restaurantZone.findUnique({ where: { id: terrace.id } });
    assert.equal(inactive.active, false);

    // El mismo nombre debe reactivar la zona retirada, no chocar con @@unique.
    const reactivated = await zones.createZone(tenant.id, { name: 'Terraza' });
    assert.equal(reactivated.id, terrace.id);
    assert.equal(reactivated.active, true);

    process.env.RESTAURANT_PUBLIC_BASE_URL = 'https://qr.example.test';
    const qrBefore = await qr.tableMaterial(tenant.id, null, legacyTable.id);
    assert.equal(qrBefore.url.startsWith('https://qr.example.test/r/'), true);
    assert.match(qrBefore.svg, /<svg/);
    assert.ok(!qrBefore.url.includes('192.168.'));
    assert.ok(!qrBefore.url.includes('localhost'));
    const oldToken = (await prisma.restaurantTable.findUnique({ where: { id:legacyTable.id } })).qrToken;
    const qrAfter = await qr.regenerateTableQr(tenant.id, auditUser.id, legacyTable.id);
    assert.notEqual(qrAfter.url, qrBefore.url);
    assert.equal(await prisma.restaurantTable.count({ where: { tenantId:tenant.id, qrToken:oldToken } }), 0, 'old QR token must be invalidated immediately');
    const qrAudit = await prisma.auditoriaContable.findFirst({ where: { tenantId: tenant.id, entidad: 'RESTAURANT_TABLE_QR', entidadId: legacyTable.id, accion: 'REGENERATE' } });
    assert.ok(qrAudit, 'QR regeneration must leave an audit record');
    assert.equal(qrAudit.userId, auditUser.id);

    const second = await restaurant.createTable(tenant.id, { code: 'M2', name: 'Mesa nueva', seats: 2 });
    const assignedSecond = await zones.assignTable(tenant.id, second.id, reactivated.id);
    assert.equal(assignedSecond.zoneId, reactivated.id);

    console.log('RESTAURANT ZONES POSTGRESQL SMOKE OK');
    console.log(JSON.stringify({
      runtimeSchemaIncludesZones: true,
      defaultZone: defaultZone.name,
      legacyBackfilled: true,
      explicitZoneAssignment: true,
      zoneWithTablesProtected: true,
      deletedZoneReactivated: true,
      canonicalPublicQr: true,
      qrSvgGeneratedLocally: true,
      qrRegenerationInvalidatesOldToken: true,
      qrRegenerationAudited: true
    }, null, 2));
  } finally {
    await prisma.auditoriaContable.deleteMany({ where: { tenantId: tenant.id, entidad: 'RESTAURANT_TABLE_QR' } });
    await prisma.restaurantTable.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.restaurantZone.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());