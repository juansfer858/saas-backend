-- P13-E1 · Usuarios / roles / permisos locales con outbox transaccional
-- Aplicar únicamente sobre la base PostgreSQL aislada del laboratorio P13.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS p13_entity_version (
  tenant_id TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE OR REPLACE FUNCTION p13_next_entity_version(
  p_tenant_id TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT
) RETURNS BIGINT AS $$
DECLARE
  v_version BIGINT;
BEGIN
  INSERT INTO p13_entity_version(tenant_id, entity_type, entity_id, version, updated_at)
  VALUES (p_tenant_id, p_entity_type, p_entity_id, 1, NOW())
  ON CONFLICT (tenant_id, entity_type, entity_id)
  DO UPDATE SET version=p13_entity_version.version + 1, updated_at=NOW()
  RETURNING version INTO v_version;
  RETURN v_version;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION p13_identity_active_installation(p_tenant_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_installation_id TEXT;
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)::int, MIN(installation_id)
    INTO v_count, v_installation_id
    FROM p13_installation_identity
   WHERE tenant_id=p_tenant_id AND revoked_at IS NULL;

  IF v_count <> 1 OR v_installation_id IS NULL THEN
    RAISE EXCEPTION 'P13_E1_ACTIVE_INSTALLATION_REQUIRED:%', v_count;
  END IF;
  RETURN v_installation_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION p13_identity_emit_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_row JSONB;
  v_payload JSONB;
  v_tenant_id TEXT;
  v_entity_type TEXT;
  v_entity_id TEXT;
  v_installation_id TEXT;
  v_version BIGINT;
  v_operation TEXT;
BEGIN
  v_row := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_operation := CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END;

  IF TG_TABLE_NAME='User' THEN
    v_tenant_id := v_row->>'tenantId';
    v_entity_type := 'IDENTITY_USER';
    v_entity_id := v_row->>'id';
    -- Nunca enviar password ni hash de password por el outbox.
    v_payload := jsonb_build_object(
      'id', v_row->>'id',
      'tenantId', v_row->>'tenantId',
      'nombre', v_row->>'nombre',
      'email', v_row->>'email',
      'rol', v_row->>'rol',
      'activo', COALESCE((v_row->>'activo')::boolean, false)
    );
  ELSIF TG_TABLE_NAME='RbacRole' THEN
    v_tenant_id := v_row->>'tenantId';
    v_entity_type := 'IDENTITY_RBAC_ROLE';
    v_entity_id := v_row->>'id';
    v_payload := v_row;
  ELSIF TG_TABLE_NAME='RbacUserRole' THEN
    v_tenant_id := v_row->>'tenantId';
    v_entity_type := 'IDENTITY_RBAC_USER_ROLE';
    v_entity_id := v_row->>'id';
    v_payload := v_row;
  ELSIF TG_TABLE_NAME='RbacUserPermissionOverride' THEN
    v_tenant_id := v_row->>'tenantId';
    v_entity_type := 'IDENTITY_RBAC_OVERRIDE';
    v_entity_id := v_row->>'id';
    v_payload := v_row;
  ELSE
    RAISE EXCEPTION 'P13_E1_UNSUPPORTED_TRIGGER_TABLE:%', TG_TABLE_NAME;
  END IF;

  IF v_tenant_id IS NULL OR v_entity_id IS NULL THEN
    RAISE EXCEPTION 'P13_E1_IDENTITY_ROW_INVALID:%', TG_TABLE_NAME;
  END IF;

  v_installation_id := p13_identity_active_installation(v_tenant_id);
  v_version := p13_next_entity_version(v_tenant_id, v_entity_type, v_entity_id);

  INSERT INTO p13_sync_outbox(
    event_id, tenant_id, installation_id, entity_type, entity_id, operation,
    entity_version, occurred_at, payload, payload_sha256
  ) VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    v_installation_id,
    v_entity_type,
    v_entity_id,
    v_operation,
    v_version,
    NOW(),
    v_payload,
    encode(digest(v_payload::text, 'sha256'), 'hex')
  );

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION p13_rbac_role_permission_emit_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_row JSONB;
  v_tenant_id TEXT;
  v_entity_id TEXT;
  v_installation_id TEXT;
  v_version BIGINT;
  v_operation TEXT;
BEGIN
  v_row := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_operation := CASE WHEN TG_OP='INSERT' THEN 'CREATE' ELSE 'DELETE' END;
  v_entity_id := v_row->>'id';

  SELECT "tenantId" INTO v_tenant_id
    FROM "RbacRole"
   WHERE id=(v_row->>'roleId');

  IF v_tenant_id IS NULL OR v_entity_id IS NULL THEN
    RAISE EXCEPTION 'P13_E1_ROLE_PERMISSION_TENANT_REQUIRED';
  END IF;

  v_installation_id := p13_identity_active_installation(v_tenant_id);
  v_version := p13_next_entity_version(v_tenant_id, 'IDENTITY_RBAC_ROLE_PERMISSION', v_entity_id);

  INSERT INTO p13_sync_outbox(
    event_id, tenant_id, installation_id, entity_type, entity_id, operation,
    entity_version, occurred_at, payload, payload_sha256
  ) VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    v_installation_id,
    'IDENTITY_RBAC_ROLE_PERMISSION',
    v_entity_id,
    v_operation,
    v_version,
    NOW(),
    v_row,
    encode(digest(v_row::text, 'sha256'), 'hex')
  );

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS p13_e1_user_insert_delete ON "User";
DROP TRIGGER IF EXISTS p13_e1_user_update ON "User";
CREATE TRIGGER p13_e1_user_insert_delete
AFTER INSERT OR DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION p13_identity_emit_outbox();
CREATE TRIGGER p13_e1_user_update
AFTER UPDATE ON "User"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_identity_emit_outbox();

DROP TRIGGER IF EXISTS p13_e1_role_insert_delete ON "RbacRole";
DROP TRIGGER IF EXISTS p13_e1_role_update ON "RbacRole";
CREATE TRIGGER p13_e1_role_insert_delete
AFTER INSERT OR DELETE ON "RbacRole"
FOR EACH ROW EXECUTE FUNCTION p13_identity_emit_outbox();
CREATE TRIGGER p13_e1_role_update
AFTER UPDATE ON "RbacRole"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_identity_emit_outbox();

DROP TRIGGER IF EXISTS p13_e1_user_role_insert_delete ON "RbacUserRole";
DROP TRIGGER IF EXISTS p13_e1_user_role_update ON "RbacUserRole";
CREATE TRIGGER p13_e1_user_role_insert_delete
AFTER INSERT OR DELETE ON "RbacUserRole"
FOR EACH ROW EXECUTE FUNCTION p13_identity_emit_outbox();
CREATE TRIGGER p13_e1_user_role_update
AFTER UPDATE ON "RbacUserRole"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_identity_emit_outbox();

DROP TRIGGER IF EXISTS p13_e1_override_insert_delete ON "RbacUserPermissionOverride";
DROP TRIGGER IF EXISTS p13_e1_override_update ON "RbacUserPermissionOverride";
CREATE TRIGGER p13_e1_override_insert_delete
AFTER INSERT OR DELETE ON "RbacUserPermissionOverride"
FOR EACH ROW EXECUTE FUNCTION p13_identity_emit_outbox();
CREATE TRIGGER p13_e1_override_update
AFTER UPDATE ON "RbacUserPermissionOverride"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_identity_emit_outbox();

DROP TRIGGER IF EXISTS p13_e1_role_permission_insert ON "RbacRolePermission";
DROP TRIGGER IF EXISTS p13_e1_role_permission_delete ON "RbacRolePermission";
CREATE TRIGGER p13_e1_role_permission_insert
AFTER INSERT ON "RbacRolePermission"
FOR EACH ROW EXECUTE FUNCTION p13_rbac_role_permission_emit_outbox();
CREATE TRIGGER p13_e1_role_permission_delete
BEFORE DELETE ON "RbacRolePermission"
FOR EACH ROW EXECUTE FUNCTION p13_rbac_role_permission_emit_outbox();
