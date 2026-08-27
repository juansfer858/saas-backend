const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const zones = require('../src/modules/restaurant/restaurant-zones.service');

async function main() {
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

  try {
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

    const second = await restaurant.createTable(tenant.id, { code: 'M2', name: 'Mesa nueva', seats: 2 });
    const assignedSecond = await zones.assignTable(tenant.id, second.id, reactivated.id);
    assert.equal(assignedSecond.zoneId, reactivated.id);

    console.log('RESTAURANT ZONES POSTGRESQL SMOKE OK');
    console.log(JSON.stringify({
      defaultZone: defaultZone.name,
      legacyBackfilled: true,
      explicitZoneAssignment: true,
      zoneWithTablesProtected: true,
      deletedZoneReactivated: true
    }, null, 2));
  } finally {
    await prisma.restaurantTable.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.restaurantZone.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
