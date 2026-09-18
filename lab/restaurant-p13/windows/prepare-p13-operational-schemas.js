'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const INSTALL_DIR = path.resolve(process.env.P13_INSTALL_DIR || 'C:\\ProgramData\\VantixGC\\Restaurant-P13');
const APP_DIR = path.join(INSTALL_DIR, 'app');
const SQL_DIR = path.join(APP_DIR, 'lab', 'restaurant-p13', 'sql');
const IDENTITY_FILE = path.join(INSTALL_DIR, 'secrets', 'installation-identity.json');
const REQUIRED_SQL = [
  '001-p13-sync.sql',
  '002-p13-recovery.sql',
  '003-p13-e1-identity-outbox.sql',
  '004-p13-e2-table-visit-outbox.sql',
  '005-p13-e3-order-person-outbox.sql',
  '006-p13-e4-kds-print-queue.sql',
  '007-p13-e5-cash-reprint.sql'
];

function readSql(name) {
  const file = path.join(SQL_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`P13_SQL_MISSING:${name}`);
  return fs.readFileSync(file, 'utf8');
}

function assertDatabaseUrl(raw) {
  if (!raw) throw new Error('P13_DATABASE_URL_MISSING');
  const url = new URL(raw);
  const host = String(url.hostname || '').toLowerCase();
  const port = Number(url.port || 5432);
  const db = decodeURIComponent(String(url.pathname || '').replace(/^\//, '')).split('/')[0];
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || port !== 55432 || db !== 'vantix_p13_lab') {
    throw new Error(`P13_DATABASE_URL_NOT_ISOLATED:${host}:${port}/${db}`);
  }
  return raw;
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  if (!result.rowCount || result.rows.length !== 1) throw new Error('P13_SCALAR_RESULT_INVALID');
  const values = Object.values(result.rows[0]);
  if (values.length !== 1) throw new Error('P13_SCALAR_COLUMN_INVALID');
  return values[0];
}

async function ensureIdentity(client, tenantId) {
  const active = await client.query(`
    SELECT installation_id, public_key_sha256
      FROM p13_installation_identity
     WHERE tenant_id=$1 AND revoked_at IS NULL
     ORDER BY created_at ASC
  `, [tenantId]);

  if (active.rowCount > 1) throw new Error('P13_MULTIPLE_ACTIVE_INSTALLATIONS');
  let installationId;
  let fingerprint;

  if (active.rowCount === 1) {
    installationId = active.rows[0].installation_id;
    fingerprint = active.rows[0].public_key_sha256;
  } else {
    installationId = `installation-p13-win-${crypto.randomUUID()}`;
    fingerprint = crypto.randomBytes(32).toString('hex');
    await client.query(`
      INSERT INTO p13_installation_identity(
        installation_id, tenant_id, public_key_sha256, last_seen_at
      ) VALUES ($1,$2,$3,NOW())
    `, [installationId, tenantId, fingerprint]);
  }

  fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
  if (!fs.existsSync(IDENTITY_FILE)) {
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify({
      installationId,
      tenantId,
      tenantSubdomain: 'demo-restaurante',
      publicKeySha256: fingerprint,
      pilot: true,
      createdAt: new Date().toISOString()
    }, null, 2), { encoding: 'utf8', flag: 'wx' });
  }

  return { installationId, fingerprint };
}

async function main() {
  const databaseUrl = assertDatabaseUrl(process.env.DATABASE_URL);
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 8000, statement_timeout: 30000 });
  await client.connect();
  try {
    console.log('P13_WINDOWS_OPERATIONAL_SCHEMA_CONNECT_OK');

    const tenants = await client.query('SELECT id, subdomain FROM "Tenant" ORDER BY id');
    if (tenants.rowCount !== 1 || tenants.rows[0].subdomain !== 'demo-restaurante') {
      throw new Error('P13_SINGLE_TENANT_REQUIRED');
    }
    const tenantId = tenants.rows[0].id;

    await client.query('BEGIN');
    try {
      for (const name of REQUIRED_SQL.slice(0, 2)) {
        await client.query(readSql(name));
        console.log(`P13_WINDOWS_SQL_OK ${name}`);
      }

      const identity = await ensureIdentity(client, tenantId);
      console.log(`P13_WINDOWS_IDENTITY_OK ${identity.installationId}`);

      for (const name of REQUIRED_SQL.slice(2)) {
        await client.query(readSql(name));
        console.log(`P13_WINDOWS_SQL_OK ${name}`);
      }

      const ready = await scalar(client, `
        SELECT CASE WHEN
          to_regclass('public.p13_sync_outbox') IS NOT NULL AND
          to_regclass('public.p13_recovery_history') IS NOT NULL AND
          to_regclass('public.p13_entity_version') IS NOT NULL AND
          to_regclass('public.p13_local_print_queue') IS NOT NULL AND
          to_regclass('public.p13_local_receipt_reprint_queue') IS NOT NULL AND
          EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e2_table_update' AND NOT tgisinternal) AND
          EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e3_order_insert' AND NOT tgisinternal) AND
          EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='p13_e4_command_print_queue' AND NOT tgisinternal)
        THEN 'READY' ELSE 'MISSING' END AS state
      `);
      if (ready !== 'READY') throw new Error('P13_OPERATIONAL_SCHEMA_INCOMPLETE');

      await client.query('COMMIT');
      console.log(`P13_WINDOWS_OPERATIONAL_SCHEMA_001_007_OK installation=${identity.installationId}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`P13_WINDOWS_OPERATIONAL_SCHEMA_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
