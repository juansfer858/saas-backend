'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { canonicalize } = require('../security/offline-license');

const SOURCE_DB_NAME = 'vantix_p13_lab';
const RESTORE_DB_NAME = 'vantix_p13_restore_lab';
const REQUIRED_DB_PORT = 55432;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseSafeDbUrl(raw, expectedName) {
  let url;
  try { url = new URL(String(raw || '')); }
  catch { throw new Error('P13_RECOVERY_DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('P13_RECOVERY_DATABASE_PROTOCOL_INVALID');
  if (!LOOPBACK_HOSTS.has(String(url.hostname || '').toLowerCase())) throw new Error('P13_RECOVERY_DATABASE_NOT_LOCAL');
  if (Number(url.port || 5432) !== REQUIRED_DB_PORT) throw new Error('P13_RECOVERY_DATABASE_PORT_INVALID');
  const dbName = decodeURIComponent(String(url.pathname || '').replace(/^\//, '')).split('/')[0];
  if (dbName !== expectedName) throw new Error(`P13_RECOVERY_DATABASE_NAME_INVALID:${dbName}`);
  return { url, dbName };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const bytes = fs.readFileSync(file);
  hash.update(bytes);
  return hash.digest('hex');
}

function runPgTool(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8', env: { ...process.env } });
  if (result.error) throw new Error(`P13_RECOVERY_TOOL_MISSING:${tool}:${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`P13_RECOVERY_TOOL_FAILED:${tool}:${String(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

async function tenantInventory(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const tenants = await client.query('SELECT id, subdomain, "nombreEmpresa" FROM "Tenant" ORDER BY "creadoEn" ASC');
    if (tenants.rowCount !== 1) throw new Error(`P13_RECOVERY_SINGLE_TENANT_REQUIRED:${tenants.rowCount}`);
    const tenant = tenants.rows[0];

    const columns = await client.query(`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema=c.table_schema AND t.table_name=c.table_name
       WHERE c.table_schema='public'
         AND t.table_type='BASE TABLE'
         AND c.column_name IN ('tenantId','tenant_id')
       ORDER BY c.table_name, c.column_name
    `);

    const tableCounts = {};
    for (const row of columns.rows) {
      const table = row.table_name;
      if (tableCounts[table] !== undefined) continue;
      const column = row.column_name;
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)}=$1`,
        [tenant.id]
      );
      tableCounts[table] = result.rows[0].count;
    }

    const activeInstallations = await client.query(`
      SELECT installation_id, public_key_sha256
        FROM p13_installation_identity
       WHERE tenant_id=$1 AND revoked_at IS NULL
       ORDER BY created_at ASC
    `, [tenant.id]);
    if (activeInstallations.rowCount !== 1) {
      throw new Error(`P13_RECOVERY_ACTIVE_INSTALLATION_REQUIRED:${activeInstallations.rowCount}`);
    }

    const sync = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM p13_sync_outbox WHERE tenant_id=$1) AS outbox,
        (SELECT COUNT(*)::int FROM p13_sync_outbox WHERE tenant_id=$1 AND status<>'SENT') AS outbox_pending,
        (SELECT COUNT(*)::int FROM p13_sync_inbox WHERE tenant_id=$1) AS inbox,
        (SELECT COUNT(*)::int FROM p13_sync_inbox WHERE tenant_id=$1 AND status<>'APPLIED') AS inbox_pending
    `, [tenant.id]);

    const inventory = {
      tenant: { id: tenant.id, subdomain: tenant.subdomain, nombreEmpresa: tenant.nombreEmpresa },
      activeInstallation: activeInstallations.rows[0],
      tableCounts,
      sync: sync.rows[0]
    };
    const inventorySha256 = crypto.createHash('sha256').update(Buffer.from(canonicalize(inventory), 'utf8')).digest('hex');
    return { inventory, inventorySha256 };
  } finally {
    await client.end();
  }
}

async function createSnapshot({ sourceUrl, outputDir }) {
  parseSafeDbUrl(sourceUrl, SOURCE_DB_NAME);
  const { inventory, inventorySha256 } = await tenantInventory(sourceUrl);
  fs.mkdirSync(outputDir, { recursive: true });

  const snapshotId = crypto.randomUUID();
  const dumpFile = `p13-${inventory.tenant.subdomain}-${snapshotId}.dump`;
  const dumpPath = path.join(outputDir, dumpFile);
  runPgTool('pg_dump', [
    '--dbname', sourceUrl,
    '--format=custom',
    '--compress=6',
    '--no-owner',
    '--no-privileges',
    '--file', dumpPath
  ]);

  const dumpSha256 = sha256File(dumpPath);
  const manifest = {
    snapshotVersion: 1,
    snapshotId,
    phase: 'P13-I',
    createdAt: new Date().toISOString(),
    tenant: inventory.tenant,
    installationId: inventory.activeInstallation.installation_id,
    publicKeySha256: inventory.activeInstallation.public_key_sha256,
    sourceDatabase: SOURCE_DB_NAME,
    dumpFile,
    dumpSha256,
    inventorySha256,
    inventory
  };
  const manifestPath = path.join(outputDir, `${snapshotId}.manifest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestPath, dumpPath };
}

async function restoreSnapshot({ manifestPath, targetUrl }) {
  parseSafeDbUrl(targetUrl, RESTORE_DB_NAME);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.snapshotVersion !== 1 || manifest.sourceDatabase !== SOURCE_DB_NAME) {
    throw new Error('P13_SNAPSHOT_MANIFEST_INVALID');
  }
  const dumpPath = path.join(path.dirname(manifestPath), manifest.dumpFile);
  if (!fs.existsSync(dumpPath)) throw new Error('P13_SNAPSHOT_DUMP_MISSING');
  const actualHash = sha256File(dumpPath);
  if (actualHash !== manifest.dumpSha256) throw new Error('P13_SNAPSHOT_HASH_MISMATCH');

  runPgTool('pg_restore', [
    '--dbname', targetUrl,
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    dumpPath
  ]);

  const restored = await tenantInventory(targetUrl);
  if (restored.inventorySha256 !== manifest.inventorySha256) {
    throw new Error('P13_SNAPSHOT_INVENTORY_MISMATCH');
  }
  if (restored.inventory.tenant.id !== manifest.tenant.id || restored.inventory.tenant.subdomain !== manifest.tenant.subdomain) {
    throw new Error('P13_SNAPSHOT_TENANT_MISMATCH');
  }
  return { manifest, restored };
}

async function rotateInstallationAfterRestore({ targetUrl, manifest, newInstallationId, newPublicKeySha256 }) {
  parseSafeDbUrl(targetUrl, RESTORE_DB_NAME);
  if (!/^[a-f0-9]{64}$/.test(String(newPublicKeySha256 || ''))) throw new Error('P13_RECOVERY_NEW_KEY_HASH_INVALID');
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT installation_id
        FROM p13_installation_identity
       WHERE tenant_id=$1 AND revoked_at IS NULL
       FOR UPDATE
    `, [manifest.tenant.id]);
    if (current.rowCount !== 1) throw new Error(`P13_RECOVERY_ACTIVE_INSTALLATION_REQUIRED:${current.rowCount}`);
    const previousInstallationId = current.rows[0].installation_id;
    if (previousInstallationId !== manifest.installationId) throw new Error('P13_RECOVERY_PREVIOUS_INSTALLATION_MISMATCH');

    await client.query(`
      UPDATE p13_installation_identity
         SET revoked_at=NOW(), last_seen_at=NOW()
       WHERE installation_id=$1
    `, [previousInstallationId]);
    await client.query(`
      INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
      VALUES ($1,$2,$3,NOW())
    `, [newInstallationId, manifest.tenant.id, newPublicKeySha256]);

    const recoveryId = crypto.randomUUID();
    await client.query(`
      INSERT INTO p13_recovery_history(
        recovery_id, tenant_id, snapshot_id, snapshot_sha256,
        previous_installation_id, new_installation_id, status, details
      ) VALUES ($1,$2,$3,$4,$5,$6,'VALIDATED',$7::jsonb)
    `, [
      recoveryId,
      manifest.tenant.id,
      manifest.snapshotId,
      manifest.dumpSha256,
      previousInstallationId,
      newInstallationId,
      JSON.stringify({ inventorySha256: manifest.inventorySha256, sourceDatabase: manifest.sourceDatabase })
    ]);
    await client.query('COMMIT');
    return { recoveryId, previousInstallationId, newInstallationId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = {
  SOURCE_DB_NAME,
  RESTORE_DB_NAME,
  REQUIRED_DB_PORT,
  parseSafeDbUrl,
  tenantInventory,
  createSnapshot,
  restoreSnapshot,
  rotateInstallationAfterRestore,
  sha256File
};
