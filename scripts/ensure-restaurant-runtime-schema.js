const crypto = require('node:crypto');
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
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantConfig'
          AND column_name = 'paymentMethods'
      ) AS "configPaymentMethods",
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
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'qrVisitNonce'
      ) AS "sessionQrVisitNonce",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'paymentMethodId'
      ) AS "sessionPaymentMethodId",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'paymentMethodLabel'
      ) AS "sessionPaymentMethodLabel",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'paymentMethodKind'
      ) AS "sessionPaymentMethodKind",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'paymentAccountId'
      ) AS "sessionPaymentAccountId",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'paymentReference'
      ) AS "sessionPaymentReference",
      to_regclass('public."RestaurantQrVisitDevice"')::text AS "qrVisitDevice",
      to_regclass('public."RestaurantSessionPayment"')::text AS "sessionPayment",
      to_regclass('public."RestaurantOrder"')::text AS "order",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantOrder'
          AND column_name = 'qrVisitDeviceId'
      ) AS "orderQrVisitDeviceId",
      to_regclass('public."RestaurantOrderItem"')::text AS "orderItem",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantOrderItem'
          AND column_name = 'seatNumber'
      ) AS "orderItemSeatNumber",
      to_regclass('public."RestaurantCommand"')::text AS "command",
      to_regclass('public."RestaurantFiscalDocument"')::text AS "fiscalDocument",
      to_regclass('public."RestaurantDeliveryOrder"')::text AS "deliveryOrder",
      to_regclass('public."RestaurantDeliveryItem"')::text AS "deliveryItem",
      to_regclass('public."RestaurantDeliveryCommand"')::text AS "deliveryCommand",
      to_regclass('public."RestaurantEmployeeWorkProfile"')::text AS "employeeWorkProfile",
      to_regclass('public."RestaurantCompanyProfile"')::text AS "companyProfile",
      to_regclass('public."PrintTenantConfig"')::text AS "printTenantConfig",
      to_regclass('public."PrinterEndpoint"')::text AS "printerEndpoint",
      EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'PrinterTransport'
          AND e.enumlabel = 'WINDOWS'
      ) AS "printerTransportWindows"
  `);
  const state = rows?.[0] || {};
  const required = [
    'config', 'configPaymentMethods', 'zone', 'table', 'tableZoneId', 'menuItem', 'session',
    'sessionBillingMode', 'sessionAccountPreparedAt', 'sessionCashierRequestedAt', 'sessionQrVisitNonce',
    'sessionPaymentMethodId', 'sessionPaymentMethodLabel', 'sessionPaymentMethodKind',
    'sessionPaymentAccountId', 'sessionPaymentReference',
    'qrVisitDevice', 'sessionPayment', 'order', 'orderQrVisitDeviceId',
    'orderItem', 'orderItemSeatNumber', 'command', 'fiscalDocument',
    'deliveryOrder', 'deliveryItem', 'deliveryCommand', 'employeeWorkProfile', 'companyProfile',
    'printTenantConfig', 'printerEndpoint', 'printerTransportWindows'
  ];
  const ready = required.every((key) => Boolean(state[key]));
  return { ready, state };
}

async function prepareLegacyQrVisitNonce() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      to_regclass('public."RestaurantTableSession"')::text AS "sessionTable",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'RestaurantTableSession'
          AND column_name = 'qrVisitNonce'
      ) AS "hasQrVisitNonce"
  `);
  const state = rows?.[0] || {};
  if (!state.sessionTable) return { changed: false, rowsBackfilled: 0 };

  let changed = false;
  if (!state.hasQrVisitNonce) {
    // Prisma's uuid() is a client-level default. `db push` cannot add this field as
    // NOT NULL when legacy sessions already exist, so stage it safely first.
    await prisma.$executeRawUnsafe('ALTER TABLE "RestaurantTableSession" ADD COLUMN IF NOT EXISTS "qrVisitNonce" TEXT');
    changed = true;
    console.warn('RESTAURANT_SCHEMA_COMPAT_ADDED nullable=RestaurantTableSession.qrVisitNonce');
  }

  const legacyRows = await prisma.$queryRawUnsafe('SELECT "id" FROM "RestaurantTableSession" WHERE "qrVisitNonce" IS NULL');
  let rowsBackfilled = 0;
  for (const row of legacyRows) {
    const updated = await prisma.$executeRawUnsafe(
      'UPDATE "RestaurantTableSession" SET "qrVisitNonce" = $1 WHERE "id" = $2 AND "qrVisitNonce" IS NULL',
      crypto.randomUUID(),
      row.id
    );
    rowsBackfilled += Number(updated || 0);
  }

  if (rowsBackfilled) {
    changed = true;
    console.warn(`RESTAURANT_SCHEMA_COMPAT_BACKFILLED field=RestaurantTableSession.qrVisitNonce rows=${rowsBackfilled}`);
  }

  const remaining = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "RestaurantTableSession" WHERE "qrVisitNonce" IS NULL');
  if (Number(remaining?.[0]?.count || 0) !== 0) {
    throw new Error('No fue posible completar qrVisitNonce para todas las sesiones Restaurante existentes');
  }
  return { changed, rowsBackfilled };
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
    const compatibility = await prepareLegacyQrVisitNonce();
    await runPrismaDbPush();

    const after = await readRestaurantSchemaState();
    if (!after.ready) {
      throw new Error(`El esquema Restaurante sigue incompleto después de prisma db push: ${Object.entries(after.state).filter(([, value]) => !value).map(([key]) => key).join(',')}`);
    }
    console.log('RESTAURANT_SCHEMA_SYNC_READY');
    return { changed: true, ready: true, compatibility };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { readRestaurantSchemaState, prepareLegacyQrVisitNonce, ensureRestaurantRuntimeSchema };
