'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');

const QR_COMPATIBILITY_CONTRACT = 'RESTAURANT_QR_PERMANENT_ABI_V1';
const QR_PUBLIC_PATH = '/r/:qrToken';
const QR_GUARD_FUNCTION = 'vantix_restaurant_guard_qr_token_update';
const QR_GUARD_TRIGGER = 'restaurant_qr_token_immutable_guard';
const QR_REGEN_SETTING = 'vantix.restaurant_qr_regenerate';

async function guardState(client = prisma) {
  const rows = await client.$queryRawUnsafe(`
    SELECT
      to_regclass('public."RestaurantTable"')::text AS "table",
      EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = '${QR_GUARD_TRIGGER}'
          AND NOT tgisinternal
      ) AS "trigger"
  `);
  const state = rows?.[0] || {};
  return { table: Boolean(state.table), installed: Boolean(state.trigger) };
}

async function ensureQrTokenGuard(client = prisma) {
  const state = await guardState(client);
  if (!state.table) return { installed: false, skipped: true };

  await client.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${QR_GUARD_FUNCTION}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."qrToken" IS DISTINCT FROM OLD."qrToken"
         AND COALESCE(current_setting('${QR_REGEN_SETTING}', true), '') <> 'allowed' THEN
        RAISE EXCEPTION 'RESTAURANT_QR_TOKEN_IMMUTABLE'
          USING ERRCODE = 'P0001',
                DETAIL = 'Use only the audited Restaurant QR regeneration transaction.';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${QR_GUARD_TRIGGER} ON "RestaurantTable"`);
  await client.$executeRawUnsafe(`
    CREATE TRIGGER ${QR_GUARD_TRIGGER}
    BEFORE UPDATE OF "qrToken" ON "RestaurantTable"
    FOR EACH ROW
    EXECUTE FUNCTION ${QR_GUARD_FUNCTION}()
  `);

  return { installed: true, skipped: false };
}

async function authorizeQrTokenRegeneration(tx) {
  await tx.$queryRawUnsafe(`SELECT set_config('${QR_REGEN_SETTING}', 'allowed', true)`);
}

function publicTableUrl(baseUrl, qrToken) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/r/${encodeURIComponent(String(qrToken || ''))}`;
}

async function compatibilityDigest(client = prisma) {
  const rows = await client.restaurantTable.findMany({
    select: { tenantId: true, id: true, qrToken: true },
    orderBy: [{ tenantId: 'asc' }, { id: 'asc' }]
  });
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(`${row.tenantId}\u0000${row.id}\u0000${row.qrToken}\n`);
  return {
    contract: QR_COMPATIBILITY_CONTRACT,
    publicPath: QR_PUBLIC_PATH,
    tables: rows.length,
    digestSha256: hash.digest('hex')
  };
}

module.exports = {
  QR_COMPATIBILITY_CONTRACT,
  QR_PUBLIC_PATH,
  QR_GUARD_FUNCTION,
  QR_GUARD_TRIGGER,
  QR_REGEN_SETTING,
  guardState,
  ensureQrTokenGuard,
  authorizeQrTokenRegeneration,
  publicTableUrl,
  compatibilityDigest
};
