'use strict';

const crypto = require('node:crypto');
const { canonicalize } = require('../security/offline-license');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payloadHash(payload) {
  return crypto.createHash('sha256').update(Buffer.from(canonicalize(payload), 'utf8')).digest('hex');
}

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`P13_SYNC_FIELD_REQUIRED:${field}`);
  return text;
}

function normalizeEvent(input) {
  if (!input || typeof input !== 'object') throw new Error('P13_SYNC_EVENT_INVALID');
  const eventId = requiredText(input.eventId, 'eventId');
  if (!UUID_RE.test(eventId)) throw new Error('P13_SYNC_EVENT_ID_INVALID');
  const tenantId = requiredText(input.tenantId, 'tenantId');
  const installationId = requiredText(input.installationId || 'CLOUD', 'installationId');
  const entityType = requiredText(input.entityType, 'entityType').toUpperCase();
  const entityId = requiredText(input.entityId, 'entityId');
  const operation = requiredText(input.operation || input.eventType, 'operation').toUpperCase();
  const entityVersion = Number(input.entityVersion);
  if (!Number.isInteger(entityVersion) || entityVersion < 1) throw new Error('P13_SYNC_ENTITY_VERSION_INVALID');
  const occurredAtMs = Date.parse(String(input.occurredAt || ''));
  if (!Number.isFinite(occurredAtMs)) throw new Error('P13_SYNC_OCCURRED_AT_INVALID');
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('P13_SYNC_PAYLOAD_INVALID');
  return Object.freeze({
    eventId,
    tenantId,
    installationId,
    entityType,
    entityId,
    operation,
    eventType: String(input.eventType || operation).toUpperCase(),
    entityVersion,
    occurredAt: new Date(occurredAtMs).toISOString(),
    payload: input.payload,
    payloadSha256: payloadHash(input.payload)
  });
}

async function enqueueOutbox(client, input) {
  const event = normalizeEvent(input);
  const inserted = await client.query(`
    INSERT INTO p13_sync_outbox (
      event_id, tenant_id, installation_id, entity_type, entity_id, operation,
      entity_version, occurred_at, payload, payload_sha256
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `, [
    event.eventId,
    event.tenantId,
    event.installationId,
    event.entityType,
    event.entityId,
    event.operation,
    event.entityVersion,
    event.occurredAt,
    JSON.stringify(event.payload),
    event.payloadSha256
  ]);

  if (inserted.rowCount === 1) return Object.freeze({ inserted: true, event });
  const existing = await client.query('SELECT payload_sha256 FROM p13_sync_outbox WHERE event_id=$1', [event.eventId]);
  if (!existing.rows[0] || existing.rows[0].payload_sha256 !== event.payloadSha256) {
    throw new Error('P13_SYNC_EVENT_ID_COLLISION');
  }
  return Object.freeze({ inserted: false, duplicate: true, event });
}

async function acceptInbox(client, input) {
  const event = normalizeEvent(input);
  const inserted = await client.query(`
    INSERT INTO p13_sync_inbox (
      event_id, tenant_id, source, event_type, entity_type, entity_id,
      entity_version, occurred_at, payload, payload_sha256
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `, [
    event.eventId,
    event.tenantId,
    event.installationId,
    event.eventType,
    event.entityType,
    event.entityId,
    event.entityVersion,
    event.occurredAt,
    JSON.stringify(event.payload),
    event.payloadSha256
  ]);

  if (inserted.rowCount === 1) return Object.freeze({ inserted: true, event });
  const existing = await client.query('SELECT payload_sha256 FROM p13_sync_inbox WHERE event_id=$1', [event.eventId]);
  if (!existing.rows[0] || existing.rows[0].payload_sha256 !== event.payloadSha256) {
    throw new Error('P13_SYNC_EVENT_ID_COLLISION');
  }
  return Object.freeze({ inserted: false, duplicate: true, event });
}

async function markOutboxSent(client, eventId) {
  const result = await client.query(`
    UPDATE p13_sync_outbox
       SET status='SENT', sent_at=NOW(), last_error=NULL
     WHERE event_id=$1
     RETURNING event_id, status, sent_at
  `, [eventId]);
  if (result.rowCount !== 1) throw new Error('P13_SYNC_OUTBOX_EVENT_NOT_FOUND');
  return result.rows[0];
}

async function markInboxApplied(client, eventId) {
  const result = await client.query(`
    UPDATE p13_sync_inbox
       SET status='APPLIED', applied_at=NOW(), last_error=NULL
     WHERE event_id=$1
     RETURNING event_id, status, applied_at
  `, [eventId]);
  if (result.rowCount !== 1) throw new Error('P13_SYNC_INBOX_EVENT_NOT_FOUND');
  return result.rows[0];
}

module.exports = {
  payloadHash,
  normalizeEvent,
  enqueueOutbox,
  acceptInbox,
  markOutboxSent,
  markInboxApplied
};
