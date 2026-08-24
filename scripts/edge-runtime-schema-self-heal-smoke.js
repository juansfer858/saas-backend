const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const {
  EDGE_TABLE_KEYS,
  readEdgeSchemaState,
  ensureEdgeRuntimeSchema
} = require('./ensure-edge-runtime-schema');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /ensureEdgeRuntimeSchema/);
assert.match(serverSource, /EDGE_SCHEMA_RUNTIME_READY/);
assert.match(serverSource, /ensureEdgeSchemaInBackground/);

(async () => {
  try {
    const initial = await readEdgeSchemaState();
    assert.equal(initial.ready, true, 'El esquema Edge debe estar completo después de prisma db push inicial');

    const v2Tables = [
      EDGE_TABLE_KEYS.localAccessGrant,
      EDGE_TABLE_KEYS.remoteOrder,
      EDGE_TABLE_KEYS.remoteChannel,
      EDGE_TABLE_KEYS.relayRequest,
      EDGE_TABLE_KEYS.deployment,
      EDGE_TABLE_KEYS.release,
      EDGE_TABLE_KEYS.installation
    ];
    for (const table of v2Tables) {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    const broken = await readEdgeSchemaState();
    assert.equal(broken.ready, false, 'La prueba debe reproducir un esquema Edge V2 incompleto');
    assert.equal(Boolean(broken.state.installation), false, 'EdgeInstallation debe quedar ausente antes del self-heal');
    assert.equal(Boolean(broken.state.localAccessGrant), false, 'EdgeLocalAccessGrant debe quedar ausente antes del self-heal');

    const healed = await ensureEdgeRuntimeSchema();
    assert.equal(healed.ready, true);
    assert.equal(healed.changed, true);

    const final = await readEdgeSchemaState();
    assert.equal(final.ready, true, 'El self-heal debe restaurar todas las tablas Edge');
    for (const key of Object.keys(EDGE_TABLE_KEYS)) {
      assert.ok(final.state[key], `Tabla Edge faltante después de self-heal: ${key}`);
    }

    console.log('EDGE RUNTIME SCHEMA SELF-HEAL OK');
    console.log(JSON.stringify({
      reproducedMissingEdgeV2Tables: true,
      workspaceGrantRecovered: true,
      prismaDbPushSelfHeal: true,
      startupHookPresent: true,
      edgeSchemaReady: true
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
