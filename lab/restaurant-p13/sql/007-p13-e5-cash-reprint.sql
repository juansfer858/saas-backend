-- P13-E5 · Caja local mínima + cola durable de reimpresión de tirillas.
-- Sólo laboratorio P13. No modifica el esquema productivo ni el Edge 8788.

CREATE TABLE IF NOT EXISTS p13_local_receipt_reprint_queue (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  session_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  sale_number TEXT,
  requested_by_user_id TEXT,
  job JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRINTING','PRINTED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, request_id)
);

CREATE INDEX IF NOT EXISTS p13_local_receipt_reprint_pending_idx
ON p13_local_receipt_reprint_queue(tenant_id, status, available_at, created_at);

CREATE INDEX IF NOT EXISTS p13_local_receipt_reprint_sale_idx
ON p13_local_receipt_reprint_queue(tenant_id, sale_id, created_at DESC);
