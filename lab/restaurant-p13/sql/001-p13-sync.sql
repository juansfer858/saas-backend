-- P13-F · Sync local-first isolated schema
-- This file is applied only to the dedicated P13 PostgreSQL lab database.

CREATE TABLE IF NOT EXISTS p13_installation_identity (
  installation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  public_key_sha256 CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT p13_installation_public_key_hash CHECK (public_key_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS p13_sync_outbox (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  installation_id TEXT NOT NULL REFERENCES p13_installation_identity(installation_id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  entity_version BIGINT NOT NULL CHECK (entity_version >= 1),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT p13_outbox_payload_hash CHECK (payload_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS p13_sync_outbox_pending_idx
  ON p13_sync_outbox(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS p13_sync_outbox_entity_idx
  ON p13_sync_outbox(tenant_id, entity_type, entity_id, entity_version);

CREATE TABLE IF NOT EXISTS p13_sync_inbox (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version BIGINT NOT NULL CHECK (entity_version >= 1),
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','APPLYING','APPLIED','REJECTED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  last_error TEXT,
  CONSTRAINT p13_inbox_payload_hash CHECK (payload_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS p13_sync_inbox_status_idx
  ON p13_sync_inbox(tenant_id, status, received_at);

CREATE TABLE IF NOT EXISTS p13_sync_cursor (
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  stream TEXT NOT NULL,
  cursor_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, stream)
);
