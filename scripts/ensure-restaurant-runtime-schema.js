const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { prisma } = require('../src/config/prisma');

const execFileAsync = promisify(execFile);
let inFlight = null;

async function readRestaurantSchemaState() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      to_regclass('public."RestaurantConfig"')::text AS "config",
      to_regclass('public."RestaurantZone"')::text AS "zone",
      to_regclass('public."RestaurantTable"')::text AS "table",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTable'
          AND column_name = 'zoneId'
      ) AS "tableZoneId",
      to_regclass('public."RestaurantMenuItem"')::text AS "menuItem",
      to_regclass('public."RestaurantTableSession"')::text AS "session",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'billingMode'
      ) AS "sessionBillingMode",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'accountPreparedAt'
      ) AS "sessionAccountPreparedAt",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'cashierRequestedAt'
      ) AS "sessionCashierRequestedAt",
      to_regclass('public."RestaurantOrder"')::text AS "order",
      to_regclass('public."RestaurantOrderItem"')::text AS "orderItem",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantOrderItem'
          AND column_name = 'seatNumber'
      ) AS "orderItemSeatNumber",
      to_regclass('public."RestaurantCommand"')::text AS "command",
      to_regclass('public."RestaurantFiscalDocument"')::text AS "fiscalDocument"
  `);
  const state = rows?.[0] || {};
  const required = [
    'config', 'zone', 'table', 'tableZoneId', 'menuItem', 'session',
    'sessionBillingMode', 'sessionAccountPreparedAt', 'sessionCashierRequestedAt',
    'order', 'orderItem', 'orderItemSeatNumber', 'command', 'fiscalDocument'
  ];
  const ready = required.every((key) => Boolean(state[key]));
  return { ready, state };
}

async function runPrismaDbPush() {
  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) throw new Error('Prisma CLI no está disponible en el runtime para sincronizar el esquema');
  const { stdout, stderr } = await execFileAsync(process.execPath, [cli, 'db', 'push'], {
    cwd: process.cwd(),
    env: process.env,
    timeout: Math.max(Number(process.env.RESTAURANT_SCHEMA_SYNC_TIMEOUT_MS) || 180000, 30000),
    maxBuffer: 4 * 1024 * 1024
  });
  if (stdout) console.log(`RESTAURANT_SCHEMA_SYNC_STDOUT ${stdout.trim().slice(-2000)}`);
  if (stderr) console.warn(`RESTAURANT_SCHEMA_SYNC_STDERR ${stderr.trim().slice(-2000)}`);
}

async function ensureRestaurantRuntimeSchema() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const before = await readRestaurantSchemaState();
    if (before.ready) return { changed: false, ready: true };

    console.warn(`RESTAURANT_SCHEMA_SYNC_REQUIRED missing=${Object.entries(before.state).filter(([, value]) => !value).map(([key]) => key).join(',')}`);
    await runPrismaDbPush();

    const after = await readRestaurantSchemaState();
    if (!after.ready) {
      throw new Error(`El esquema Restaurante sigue incompleto después de prisma db push: ${Object.entries(after.state).filter(([, value]) => !value).map(([key]) => key).join(',')}`);
    }
    console.log('RESTAURANT_SCHEMA_SYNC_READY');
    return { changed: true, ready: true };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { readRestaurantSchemaState, ensureRestaurantRuntimeSchema };
