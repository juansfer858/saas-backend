'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { readRestaurantSchemaState, ensureRestaurantRuntimeSchema } = require('./ensure-restaurant-runtime-schema');

async function main() {
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$executeRawUnsafe('CREATE TYPE "PrinterTransport" AS ENUM (\'NAVEGADOR\', \'LAN\')');

  const legacy = await readRestaurantSchemaState();
  assert.equal(legacy.ready, false);
  assert.equal(legacy.state.printerTransportWindows, false);
  assert.equal(Boolean(legacy.state.printerEndpoint), false);
  assert.equal(Boolean(legacy.state.printTenantConfig), false);

  const result = await ensureRestaurantRuntimeSchema();
  assert.equal(result.ready, true);
  assert.equal(result.changed, true);

  const healed = await readRestaurantSchemaState();
  assert.equal(healed.ready, true);
  assert.equal(healed.state.printerTransportWindows, true);
  assert.ok(healed.state.printerEndpoint);
  assert.ok(healed.state.printTenantConfig);

  const labels = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'PrinterTransport'
    ORDER BY e.enumsortorder
  `);
  assert.deepEqual(labels.map((row) => row.enumlabel), ['NAVEGADOR', 'LAN', 'WINDOWS']);

  console.log('RESTAURANT PRINTING SCHEMA SELF-HEAL SMOKE OK', JSON.stringify({
    legacyEnumWithoutWindows:true,
    windowsEnumRestored:true,
    printerEndpointRestored:true,
    printTenantConfigRestored:true
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
