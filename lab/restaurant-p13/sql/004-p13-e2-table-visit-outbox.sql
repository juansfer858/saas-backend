-- P13-E2 · Mesas / visitas locales con outbox transaccional
-- Se aplica únicamente a PostgreSQL aislado de laboratorio P13.
-- Depende de 001-p13-sync.sql y 003-p13-e1-identity-outbox.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION p13_e2_table_emit_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_installation_id TEXT;
  v_version BIGINT;
BEGIN
  IF NEW."tenantId" IS NULL OR NEW.id IS NULL THEN
    RAISE EXCEPTION 'P13_E2_TABLE_ROW_INVALID';
  END IF;

  v_installation_id := p13_identity_active_installation(NEW."tenantId");
  v_version := p13_next_entity_version(NEW."tenantId", 'RESTAURANT_TABLE', NEW.id);
  v_payload := jsonb_build_object(
    'id', NEW.id,
    'tenantId', NEW."tenantId",
    'zoneId', NEW."zoneId",
    'code', NEW.code,
    'name', NEW.name,
    'state', NEW.state::text,
    'assignedWaiterId', NEW."assignedWaiterId",
    'active', NEW.active,
    'updatedAt', NEW."actualizadoEn"
  );

  INSERT INTO p13_sync_outbox(
    event_id, tenant_id, installation_id, entity_type, entity_id, operation,
    entity_version, occurred_at, payload, payload_sha256
  ) VALUES (
    gen_random_uuid()::text,
    NEW."tenantId",
    v_installation_id,
    'RESTAURANT_TABLE',
    NEW.id,
    'UPDATE',
    v_version,
    NOW(),
    v_payload,
    encode(digest(v_payload::text, 'sha256'), 'hex')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION p13_e2_session_emit_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_installation_id TEXT;
  v_version BIGINT;
  v_operation TEXT;
BEGIN
  IF NEW."tenantId" IS NULL OR NEW.id IS NULL THEN
    RAISE EXCEPTION 'P13_E2_SESSION_ROW_INVALID';
  END IF;

  v_operation := CASE WHEN TG_OP='INSERT' THEN 'CREATE' ELSE 'UPDATE' END;
  v_installation_id := p13_identity_active_installation(NEW."tenantId");
  v_version := p13_next_entity_version(NEW."tenantId", 'RESTAURANT_TABLE_SESSION', NEW.id);
  v_payload := jsonb_build_object(
    'id', NEW.id,
    'tenantId', NEW."tenantId",
    'tableId', NEW."tableId",
    'saleId', NEW."saleId",
    'state', NEW.state::text,
    'billingMode', NEW."billingMode"::text,
    'openedByUserId', NEW."openedByUserId",
    'closedByUserId', NEW."closedByUserId",
    'guestCount', NEW."guestCount",
    'openedAt', NEW."openedAt",
    'closedAt', NEW."closedAt",
    'updatedAt', NEW."actualizadoEn"
  );

  INSERT INTO p13_sync_outbox(
    event_id, tenant_id, installation_id, entity_type, entity_id, operation,
    entity_version, occurred_at, payload, payload_sha256
  ) VALUES (
    gen_random_uuid()::text,
    NEW."tenantId",
    v_installation_id,
    'RESTAURANT_TABLE_SESSION',
    NEW.id,
    v_operation,
    v_version,
    NOW(),
    v_payload,
    encode(digest(v_payload::text, 'sha256'), 'hex')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS p13_e2_table_update ON "RestaurantTable";
CREATE TRIGGER p13_e2_table_update
AFTER UPDATE ON "RestaurantTable"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e2_table_emit_outbox();

DROP TRIGGER IF EXISTS p13_e2_session_insert ON "RestaurantTableSession";
DROP TRIGGER IF EXISTS p13_e2_session_update ON "RestaurantTableSession";
CREATE TRIGGER p13_e2_session_insert
AFTER INSERT ON "RestaurantTableSession"
FOR EACH ROW EXECUTE FUNCTION p13_e2_session_emit_outbox();
CREATE TRIGGER p13_e2_session_update
AFTER UPDATE ON "RestaurantTableSession"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e2_session_emit_outbox();
