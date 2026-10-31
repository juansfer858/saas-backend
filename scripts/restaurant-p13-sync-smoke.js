'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { assertLabConfig } = require('../lab/restaurant-p13/runtime');
const {
  enqueueOutbox,
  acceptInbox,
  markOutboxSent,
  markInboxApplied
} = require('../lab/restaurant-p13/sync/repository');

async function main() {
  const config = assertLabConfig(process.env);
  assert.equal(config.dbName, 'vantix_p13_lab');
  assert.equal(config.dbPort, 55432);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '../lab/restaurant-p13/sql/001-p13-sync.sql'), 'utf8');
    await client.query(schemaSql);

    const tenants = await client.query('SELECT id, subdomain FROM "Tenant" ORDER BY "creadoEn" ASC');
    assert.equal(tenants.rowCount, 1, 'P13 sync smoke exige una sola empresa local');
    assert.equal(tenants.rows[0].subdomain, config.tenantSubdomain);
    const tenantId = tenants.rows[0].id;

    const installationId = 'installation-p13-sync-ci';
    const installationFingerprint = 'a'.repeat(64);
    await client.query(`
      INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256)
      VALUES ($1,$2,$3)
      ON CONFLICT (installation_id) DO UPDATE
        SET tenant_id=EXCLUDED.tenant_id, public_key_sha256=EXCLUDED.public_key_sha256, last_seen_at=NOW(), revoked_at=NULL
    `, [installationId, tenantId, installationFingerprint]);

    const orderEvent = {
      eventId: crypto.randomUUID(),
      tenantId,
      installationId,
      entityType: 'RESTAURANT_ORDER',
      entityId: 'order-local-p13-001',
      operation: 'CREATE',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: { total: 42000, source: 'MESERO', tableCode: 'M1' }
    };

    const firstOutbox = await enqueueOutbox(client, orderEvent);
    const duplicateOutbox = await enqueueOutbox(client, orderEvent);
    assert.equal(firstOutbox.inserted, true);
    assert.equal(duplicateOutbox.inserted, false);
    assert.equal(duplicateOutbox.duplicate, true);

    await assert.rejects(
      enqueueOutbox(client, { ...orderEvent, payload: { ...orderEvent.payload, total: 99999 } }),
      /P13_SYNC_EVENT_ID_COLLISION/
    );

    const sent = await markOutboxSent(client, orderEvent.eventId);
    assert.equal(sent.status, 'SENT');

    const qrEvent = {
      eventId: crypto.randomUUID(),
      tenantId,
      installationId: 'CORE',
      eventType: 'QR_ORDER_CREATED',
      operation: 'QR_ORDER_CREATED',
      entityType: 'RESTAURANT_ORDER',
      entityId: 'qr-order-p13-001',
      entityVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: { tableCode: 'M2', items: [{ sku: 'REST-HAMB', quantity: 1 }] }
    };

    const firstInbox = await acceptInbox(client, qrEvent);
    const duplicateInbox = await acceptInbox(client, qrEvent);
    assert.equal(firstInbox.inserted, true);
    assert.equal(duplicateInbox.inserted, false);
    assert.equal(duplicateInbox.duplicate, true);

    await assert.rejects(
      acceptInbox(client, { ...qrEvent, payload: { tableCode: 'M2', items: [] } }),
      /P13_SYNC_EVENT_ID_COLLISION/
    );

    const applied = await markInboxApplied(client, qrEvent.eventId);
    assert.equal(applied.status, 'APPLIED');

    const outboxCount = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_outbox WHERE event_id=$1', [orderEvent.eventId]);
    const inboxCount = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_inbox WHERE event_id=$1', [qrEvent.eventId]);
    assert.equal(outboxCount.rows[0].count, 1);
    assert.equal(inboxCount.rows[0].count, 1);

    const foreignTenantEvent = {
      ...orderEvent,
      eventId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      entityId: 'foreign-tenant-blocked'
    };
    await assert.rejects(enqueueOutbox(client, foreignTenantEvent), /foreign key|violates foreign key/i);

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-F-SYNC-LAB',
      tenant: config.tenantSubdomain,
      outboxIdempotency: 'OK',
      inboxIdempotency: 'OK',
      collisionDetection: 'OK',
      singleTenantForeignKey: 'OK',
      qrCloudToLocalEnvelope: 'OK',
      productionTouched: false
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`P13_SYNC_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
