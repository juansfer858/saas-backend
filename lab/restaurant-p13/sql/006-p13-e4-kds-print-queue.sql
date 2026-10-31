-- P13-E4 · Producción/KDS + cola local durable de impresión.
-- Sólo laboratorio P13; no modifica Edge 8788 ni esquema productivo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS p13_local_print_queue (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  command_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  station TEXT NOT NULL,
  job JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRINTING','PRINTED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, command_id)
);

CREATE INDEX IF NOT EXISTS p13_local_print_queue_pending_idx
ON p13_local_print_queue(tenant_id, status, available_at, created_at);

CREATE OR REPLACE FUNCTION p13_e4_command_print_job()
RETURNS TRIGGER AS $$
DECLARE
  v_record JSONB;
  v_items JSONB;
  v_table_label TEXT;
  v_created_at TEXT;
  v_job JSONB;
BEGIN
  v_record := COALESCE(NEW."simulationRecord", '{}'::jsonb);
  v_items := COALESCE(v_record->'items', '[]'::jsonb);
  v_table_label := COALESCE(NULLIF(v_record#>>'{table,name}', ''), NULLIF(v_record#>>'{table,code}', ''), 'MESA');
  v_created_at := COALESCE(NULLIF(v_record->>'generatedAt', ''), NEW."creadoEn"::text);

  v_job := jsonb_build_object(
    'template', 'RESTAURANT_COMMAND_LARGE_V2',
    'paperFormat', 'TERMICA_80',
    'title', 'COMANDA',
    'tableLabel', v_table_label,
    'stationLabel', NEW.station,
    'createdAt', v_created_at,
    'traceLabel', 'PEDIDO ' || LEFT(NEW."orderId", 8),
    'cut', true,
    'lines', v_items
  );

  INSERT INTO p13_local_print_queue(
    job_id, tenant_id, command_id, order_id, station, job, status, available_at, updated_at
  ) VALUES (
    gen_random_uuid()::text,
    NEW."tenantId",
    NEW.id,
    NEW."orderId",
    NEW.station,
    v_job,
    'PENDING',
    NOW(),
    NOW()
  )
  ON CONFLICT (tenant_id, command_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS p13_e4_command_print_queue ON "RestaurantCommand";
CREATE TRIGGER p13_e4_command_print_queue
AFTER INSERT ON "RestaurantCommand"
FOR EACH ROW EXECUTE FUNCTION p13_e4_command_print_job();
