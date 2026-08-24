const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { prisma } = require('../src/config/prisma');

const execFileAsync = promisify(execFile);
let inFlight = null;

const EDGE_TABLE_KEYS = Object.freeze({
  agent: 'EdgeAgent',
  receipt: 'EdgeSyncReceipt',
  alert: 'EdgeReconciliationAlert',
  offlineConfig: 'EdgeOfflineTenantConfig',
  installation: 'EdgeInstallation',
  release: 'EdgeRelease',
  deployment: 'EdgeDeployment',
  relayRequest: 'EdgeRelayRequest',
  remoteChannel: 'EdgeRemoteChannel',
  remoteOrder: 'EdgeRemoteOrder'
});

async function readEdgeSchemaState() {
  const select = Object.entries(EDGE_TABLE_KEYS)
    .map(([key, table]) => `to_regclass('public."${table}"')::text AS "${key}"`)
    .join(',\n      ');
  const rows = await prisma.$queryRawUnsafe(`SELECT\n      ${select}`);
  const state = rows?.[0] || {};
  const ready = Object.keys(EDGE_TABLE_KEYS).every((key) => Boolean(state[key]));
  return { ready, state };
}

async function runPrismaDbPush() {
  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) throw new Error('Prisma CLI no está disponible en el runtime para sincronizar Edge');
  const { stdout, stderr } = await execFileAsync(process.execPath, [cli, 'db', 'push'], {
    cwd: process.cwd(),
    env: process.env,
    timeout: Math.max(Number(process.env.EDGE_SCHEMA_SYNC_TIMEOUT_MS) || 180000, 30000),
    maxBuffer: 4 * 1024 * 1024
  });
  if (stdout) console.log(`EDGE_SCHEMA_SYNC_STDOUT ${stdout.trim().slice(-2000)}`);
  if (stderr) console.warn(`EDGE_SCHEMA_SYNC_STDERR ${stderr.trim().slice(-2000)}`);
}

async function ensureEdgeRuntimeSchema() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const before = await readEdgeSchemaState();
    if (before.ready) return { changed: false, ready: true, state: before.state };

    const missing = Object.entries(before.state).filter(([, value]) => !value).map(([key]) => key);
    console.warn(`EDGE_SCHEMA_SYNC_REQUIRED missing=${missing.join(',')}`);
    await runPrismaDbPush();

    const after = await readEdgeSchemaState();
    if (!after.ready) {
      const stillMissing = Object.entries(after.state).filter(([, value]) => !value).map(([key]) => key);
      throw new Error(`El esquema Edge sigue incompleto después de prisma db push: ${stillMissing.join(',')}`);
    }
    console.log('EDGE_SCHEMA_SYNC_READY');
    return { changed: true, ready: true, state: after.state };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

function isMissingEdgeSchemaError(error) {
  return error?.code === 'P2021'
    || /(?:table|relation).*does not exist/i.test(String(error?.message || ''));
}

module.exports = {
  EDGE_TABLE_KEYS,
  readEdgeSchemaState,
  ensureEdgeRuntimeSchema,
  isMissingEdgeSchemaError
};
