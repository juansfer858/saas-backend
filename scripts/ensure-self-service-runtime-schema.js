const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { prisma } = require('../src/config/prisma');

const execFileAsync = promisify(execFile);
let inFlight = null;

const SELF_SERVICE_TABLE_KEYS = Object.freeze({
  subscription: 'SaasSubscription',
  onboarding: 'TenantOnboarding',
  installClaim: 'EdgeInstallClaim'
});

async function readSelfServiceSchemaState() {
  const select = Object.entries(SELF_SERVICE_TABLE_KEYS)
    .map(([key, table]) => `to_regclass('public."${table}"')::text AS "${key}"`)
    .join(',\n      ');
  const rows = await prisma.$queryRawUnsafe(`SELECT\n      ${select}`);
  const state = rows?.[0] || {};
  const ready = Object.keys(SELF_SERVICE_TABLE_KEYS).every((key) => Boolean(state[key]));
  return { ready, state };
}

async function runPrismaDbPush() {
  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) throw new Error('Prisma CLI no está disponible en el runtime para sincronizar autoservicio SaaS');
  const { stdout, stderr } = await execFileAsync(process.execPath, [cli, 'db', 'push'], {
    cwd: process.cwd(),
    env: process.env,
    timeout: Math.max(Number(process.env.SELF_SERVICE_SCHEMA_SYNC_TIMEOUT_MS) || 180000, 30000),
    maxBuffer: 4 * 1024 * 1024
  });
  if (stdout) console.log(`SELF_SERVICE_SCHEMA_SYNC_STDOUT ${stdout.trim().slice(-2000)}`);
  if (stderr) console.warn(`SELF_SERVICE_SCHEMA_SYNC_STDERR ${stderr.trim().slice(-2000)}`);
}

async function ensureSelfServiceRuntimeSchema() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const before = await readSelfServiceSchemaState();
    if (before.ready) return { changed: false, ready: true, state: before.state };
    const missing = Object.entries(before.state).filter(([, value]) => !value).map(([key]) => key);
    console.warn(`SELF_SERVICE_SCHEMA_SYNC_REQUIRED missing=${missing.join(',')}`);
    await runPrismaDbPush();
    const after = await readSelfServiceSchemaState();
    if (!after.ready) {
      const stillMissing = Object.entries(after.state).filter(([, value]) => !value).map(([key]) => key);
      throw new Error(`El esquema autoservicio sigue incompleto después de prisma db push: ${stillMissing.join(',')}`);
    }
    console.log('SELF_SERVICE_SCHEMA_SYNC_READY');
    return { changed: true, ready: true, state: after.state };
  })();
  try { return await inFlight; }
  finally { inFlight = null; }
}

module.exports = { SELF_SERVICE_TABLE_KEYS, readSelfServiceSchemaState, ensureSelfServiceRuntimeSchema };
