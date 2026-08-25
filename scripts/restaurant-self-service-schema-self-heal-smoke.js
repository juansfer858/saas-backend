const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { readSelfServiceSchemaState, ensureSelfServiceRuntimeSchema } = require('./ensure-self-service-runtime-schema');

async function main() {
  const initial = await readSelfServiceSchemaState();
  assert.equal(initial.ready, true, 'El esquema debe iniciar listo después de prisma db push');

  for (const table of ['EdgeInstallClaim', 'TenantOnboarding', 'SaasSubscription']) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
  const missing = await readSelfServiceSchemaState();
  assert.equal(missing.ready, false, 'La prueba debe detectar tablas de autoservicio faltantes');

  const repaired = await ensureSelfServiceRuntimeSchema();
  assert.equal(repaired.changed, true);
  assert.equal(repaired.ready, true);
  const after = await readSelfServiceSchemaState();
  assert.equal(after.ready, true);
  console.log('RESTAURANT SELF SERVICE SCHEMA SELF-HEAL OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
