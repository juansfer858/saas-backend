'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { readRestaurantSchemaState, ensureRestaurantRuntimeSchema } = require('./ensure-restaurant-runtime-schema');

async function main() {
  // Start from the fully synchronized CI database, then reproduce the exact production drift
  // seen after PR #198: code knows the new payment fields while PostgreSQL is still missing them.
  await prisma.$executeRawUnsafe('ALTER TABLE "RestaurantConfig" DROP COLUMN IF EXISTS "paymentMethods"');
  await prisma.$executeRawUnsafe('ALTER TABLE "RestaurantTableSession" DROP COLUMN IF EXISTS "paymentReference"');

  const broken = await readRestaurantSchemaState();
  assert.equal(broken.ready, false, 'schema gate must reject a DB missing payment fields');
  assert.equal(broken.state.configPaymentMethods, false);
  assert.equal(broken.state.sessionPaymentReference, false);

  const repaired = await ensureRestaurantRuntimeSchema();
  assert.equal(repaired.ready, true);
  assert.equal(repaired.changed, true, 'runtime gate must invoke prisma db push when payment fields are missing');

  const final = await readRestaurantSchemaState();
  assert.equal(final.ready, true);
  for (const key of [
    'configPaymentMethods',
    'sessionPaymentMethodId',
    'sessionPaymentMethodLabel',
    'sessionPaymentMethodKind',
    'sessionPaymentAccountId',
    'sessionPaymentReference'
  ]) assert.equal(final.state[key], true, `${key} must exist after self-heal`);

  console.log('RESTAURANT PAYMENT SCHEMA GATE SELF-HEAL OK');
  console.log(JSON.stringify({ detectedMissingPaymentSchema:true, prismaDbPushRecovered:true, startupGateReady:true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
