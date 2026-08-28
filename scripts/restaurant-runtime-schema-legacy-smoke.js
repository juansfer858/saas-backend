const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { readRestaurantSchemaState, ensureRestaurantRuntimeSchema } = require('./ensure-restaurant-runtime-schema');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Restaurant Legacy Schema QA ${stamp}`,
      subdomain: `rest-legacy-schema-${stamp}`,
      nicho: 'RESTAURANTE_QA',
      pais: 'CO',
      moneda: 'COP'
    }
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: 'Legacy Schema QA',
      email: `legacy-schema-${stamp}@example.test`,
      password: 'qa-not-used',
      rol: 'ADMIN'
    }
  });
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: tenant.id,
      code: `L${String(stamp).slice(-6)}`,
      name: 'Mesa legado',
      seats: 2
    }
  });
  const session = await prisma.restaurantTableSession.create({
    data: {
      tenantId: tenant.id,
      tableId: table.id,
      saleId: crypto.randomUUID(),
      openedByUserId: user.id,
      guestCount: 2
    }
  });

  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "RestaurantTableSession" DROP COLUMN "qrVisitNonce"');
    const broken = await readRestaurantSchemaState();
    assert.equal(broken.state.sessionQrVisitNonce, false, 'legacy schema must reproduce the missing qrVisitNonce field');

    const result = await ensureRestaurantRuntimeSchema();
    assert.equal(result.ready, true);
    assert.equal(result.changed, true);
    assert.equal(result.compatibility?.rowsBackfilled >= 1, true, 'legacy sessions must be backfilled before db push');

    const restored = await readRestaurantSchemaState();
    assert.equal(restored.ready, true);
    assert.equal(restored.state.sessionQrVisitNonce, true);

    const rows = await prisma.$queryRawUnsafe(
      'SELECT "qrVisitNonce", (SELECT is_nullable FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = \'RestaurantTableSession\' AND column_name = \'qrVisitNonce\') AS is_nullable FROM "RestaurantTableSession" WHERE "id" = $1',
      session.id
    );
    assert.equal(rows.length, 1);
    assert.match(String(rows[0].qrVisitNonce || ''), /^[0-9a-f-]{36}$/i);
    assert.equal(rows[0].is_nullable, 'NO', 'Prisma must finish the staged field as NOT NULL');

    console.log('RESTAURANT LEGACY QR NONCE SCHEMA SMOKE OK');
  } finally {
    await prisma.restaurantTableSession.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.restaurantTable.deleteMany({ where: { tenantId: tenant.id } });
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
