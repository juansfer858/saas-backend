'use strict';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { assertLabConfig } = require('../lab/restaurant-p13/runtime');
const {
  createSnapshot,
  restoreSnapshot,
  rotateInstallationAfterRestore,
  RESTORE_DB_NAME
} = require('../lab/restaurant-p13/recovery/repository');
const {
  enqueueOutbox,
  acceptInbox,
  markInboxApplied
} = require('../lab/restaurant-p13/sync/repository');

function dbUrlWithName(raw, name) {
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateRestoreDatabase(sourceUrl) {
  const adminUrl = dbUrlWithName(sourceUrl, 'postgres');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [RESTORE_DB_NAME]);
    await admin.query(`DROP DATABASE IF EXISTS "${RESTORE_DB_NAME}"`);
    await admin.query(`CREATE DATABASE "${RESTORE_DB_NAME}"`);
  } finally {
    await admin.end();
  }
}

async function dropRestoreDatabase(sourceUrl) {
  const adminUrl = dbUrlWithName(sourceUrl, 'postgres');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [RESTORE_DB_NAME]);
    await admin.query(`DROP DATABASE IF EXISTS "${RESTORE_DB_NAME}"`);
  } finally {
    await admin.end();
  }
}

async function prepareSource(sourceUrl, tenantSubdomain) {
  const client = new Client({ connectionString: sourceUrl });
  await client.connect();
  try {
    const sql1 = fs.readFileSync(path.join(__dirname, '../lab/restaurant-p13/sql/001-p13-sync.sql'), 'utf8');
    const sql2 = fs.readFileSync(path.join(__dirname, '../lab/restaurant-p13/sql/002-p13-recovery.sql'), 'utf8');
    await client.query(sql1);
    await client.query(sql2);

    const tenants = await client.query('SELECT id, subdomain FROM "Tenant"');
    assert.equal(tenants.rowCount, 1);
    assert.equal(tenants.rows[0].subdomain, tenantSubdomain);
    const tenantId = tenants.rows[0].id;

    let active = await client.query('SELECT installation_id FROM p13_installation_identity WHERE tenant_id=$1 AND revoked_at IS NULL', [tenantId]);
    if (active.rowCount === 0) {
      await client.query(`
        INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
        VALUES ('installation-p13-recovery-source', $1, $2, NOW())
      `, [tenantId, 'c'.repeat(64)]);
      active = await client.query('SELECT installation_id FROM p13_installation_identity WHERE tenant_id=$1 AND revoked_at IS NULL', [tenantId]);
    }
    assert.equal(active.rowCount, 1);
    const installationId = active.rows[0].installation_id;

    const outboxTotal = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_outbox WHERE tenant_id=$1', [tenantId]);
    if (outboxTotal.rows[0].count === 0) {
      await enqueueOutbox(client, {
        eventId: crypto.randomUUID(),
        tenantId,
        installationId,
        entityType: 'RECOVERY_BASELINE',
        entityId: 'baseline-before-snapshot',
        operation: 'CREATE',
        entityVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: { source: 'P13_RECOVERY_SMOKE', amount: 12345 }
      });
    }

    return { tenantId, installationId };
  } finally {
    await client.end();
  }
}

async function validateRestoredLoginHash(targetUrl) {
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT password, activo, rol
        FROM "User"
       WHERE email='admin@demo-restaurante.vantixgc.com'
    `);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].activo, true);
    assert.equal(result.rows[0].rol, 'ADMIN');
    assert.equal(await bcrypt.compare(process.env.P13_ADMIN_PASSWORD, result.rows[0].password), true);
  } finally {
    await client.end();
  }
}

async function validateReplacementContinuity({ targetUrl, manifest, previousInstallationId }) {
  const newInstallationId = 'installation-p13-recovered-ci';
  const rotation = await rotateInstallationAfterRestore({
    targetUrl,
    manifest,
    newInstallationId,
    newPublicKeySha256: 'd'.repeat(64)
  });
  assert.equal(rotation.previousInstallationId, previousInstallationId);
  assert.equal(rotation.newInstallationId, newInstallationId);

  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const active = await client.query('SELECT installation_id FROM p13_installation_identity WHERE tenant_id=$1 AND revoked_at IS NULL', [manifest.tenant.id]);
    assert.equal(active.rowCount, 1);
    assert.equal(active.rows[0].installation_id, newInstallationId);

    const old = await client.query('SELECT revoked_at FROM p13_installation_identity WHERE installation_id=$1', [previousInstallationId]);
    assert.equal(old.rowCount, 1);
    assert.ok(old.rows[0].revoked_at);

    const historical = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_outbox WHERE installation_id=$1', [previousInstallationId]);
    assert.ok(historical.rows[0].count >= 1, 'El historial de sync debe conservar la instalación anterior');

    const postRecoveryOutbox = await enqueueOutbox(client, {
      eventId: crypto.randomUUID(),
      tenantId: manifest.tenant.id,
      installationId: newInstallationId,
      entityType: 'RECOVERY_PROBE',
      entityId: 'new-pc-local-event',
      operation: 'CREATE',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: { restored: true, source: 'NEW_PC' }
    });
    assert.equal(postRecoveryOutbox.inserted, true);

    const cloudDelta = {
      eventId: crypto.randomUUID(),
      tenantId: manifest.tenant.id,
      installationId: 'CORE',
      eventType: 'QR_ORDER_CREATED',
      operation: 'QR_ORDER_CREATED',
      entityType: 'RESTAURANT_ORDER',
      entityId: 'qr-after-restore',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: { tableCode: 'M3', items: [{ sku: 'REST-LIMONADA', quantity: 1 }], afterSnapshot: true }
    };
    const accepted = await acceptInbox(client, cloudDelta);
    assert.equal(accepted.inserted, true);
    const applied = await markInboxApplied(client, cloudDelta.eventId);
    assert.equal(applied.status, 'APPLIED');

    const history = await client.query('SELECT COUNT(*)::int AS count FROM p13_recovery_history WHERE recovery_id=$1 AND status=$2', [rotation.recoveryId, 'VALIDATED']);
    assert.equal(history.rows[0].count, 1);
    return { rotation, cloudDeltaEventId: cloudDelta.eventId };
  } finally {
    await client.end();
  }
}

async function assertTamperDetection(snapshot, targetUrl) {
  const tamperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-p13-tamper-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(snapshot.manifestPath, 'utf8'));
    const tamperedDump = path.join(tamperDir, manifest.dumpFile);
    fs.copyFileSync(snapshot.dumpPath, tamperedDump);
    fs.appendFileSync(tamperedDump, Buffer.from('tampered', 'utf8'));
    const tamperedManifest = path.join(tamperDir, path.basename(snapshot.manifestPath));
    fs.writeFileSync(tamperedManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await assert.rejects(
      restoreSnapshot({ manifestPath: tamperedManifest, targetUrl }),
      /P13_SNAPSHOT_HASH_MISMATCH/
    );
  } finally {
    fs.rmSync(tamperDir, { recursive: true, force: true });
  }
}

async function main() {
  const config = assertLabConfig(process.env);
  const sourceUrl = process.env.DATABASE_URL;
  const targetUrl = dbUrlWithName(sourceUrl, RESTORE_DB_NAME);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-p13-snapshot-'));

  let restoreCreated = false;
  try {
    const source = await prepareSource(sourceUrl, config.tenantSubdomain);
    const snapshot = await createSnapshot({ sourceUrl, outputDir });
    assert.equal(snapshot.manifest.tenant.id, source.tenantId);
    assert.equal(snapshot.manifest.installationId, source.installationId);
    assert.match(snapshot.manifest.dumpSha256, /^[a-f0-9]{64}$/);

    await recreateRestoreDatabase(sourceUrl);
    restoreCreated = true;
    const restored = await restoreSnapshot({ manifestPath: snapshot.manifestPath, targetUrl });
    assert.equal(restored.restored.inventorySha256, snapshot.manifest.inventorySha256);

    await validateRestoredLoginHash(targetUrl);
    const continuity = await validateReplacementContinuity({
      targetUrl,
      manifest: snapshot.manifest,
      previousInstallationId: source.installationId
    });
    await assertTamperDetection(snapshot, targetUrl);

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-I-RECOVERY-LAB',
      snapshot: 'PG_DUMP_CUSTOM_OK',
      snapshotSha256: 'OK',
      inventoryDigest: 'OK',
      restoreToReplacementDb: 'OK',
      localAdminCredentialPreserved: 'OK',
      previousInstallationRevoked: 'OK',
      historicalOutboxPreserved: 'OK',
      newInstallationActivated: 'OK',
      localOutboxAfterRecovery: 'OK',
      cloudDeltaInboxAfterRecovery: 'OK',
      tamperDetection: 'OK',
      recoveryId: continuity.rotation.recoveryId,
      productionTouched: false
    }));
  } finally {
    if (restoreCreated) await dropRestoreDatabase(sourceUrl).catch(() => {});
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`P13_RECOVERY_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
