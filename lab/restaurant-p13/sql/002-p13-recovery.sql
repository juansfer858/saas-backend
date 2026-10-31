-- P13-I · Recovery isolated schema
-- Applied only to the dedicated P13 PostgreSQL lab database.

-- A tenant may have historical installations after a PC replacement. Only one
-- installation can remain active at a time; old installation IDs stay available
-- so historical outbox rows keep their original provenance.
ALTER TABLE p13_installation_identity
  DROP CONSTRAINT IF EXISTS p13_installation_identity_tenant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS p13_installation_identity_one_active_tenant_idx
  ON p13_installation_identity(tenant_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS p13_recovery_history (
  recovery_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  previous_installation_id TEXT NOT NULL REFERENCES p13_installation_identity(installation_id) ON DELETE RESTRICT,
  new_installation_id TEXT NOT NULL REFERENCES p13_installation_identity(installation_id) ON DELETE RESTRICT,
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'VALIDATED' CHECK (status IN ('RESTORED','VALIDATED','FAILED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT p13_recovery_snapshot_hash CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS p13_recovery_history_tenant_idx
  ON p13_recovery_history(tenant_id, restored_at DESC);
