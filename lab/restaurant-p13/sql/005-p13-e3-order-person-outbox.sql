-- P13-E3 · Pedidos / personas / comandas locales con outbox transaccional
-- Únicamente PostgreSQL aislado P13. No modifica el esquema productivo.
-- Depende de 001-p13-sync.sql, 003-p13-e1-identity-outbox.sql y 004-p13-e2-table-visit-outbox.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION p13_e3_project_payload(p_entity_type TEXT, p_row JSONB)
RETURNS JSONB AS $$
BEGIN
  CASE p_entity_type
    WHEN 'COMMERCIAL_SALE' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'id', p_row->'id',
        'tenantId', p_row->'tenantId',
        'numero', p_row->'numero',
        'tipo', p_row->'tipo',
        'estado', p_row->'estado',
        'sourceId', p_row->'sourceId',
        'terceroId', p_row->'terceroId',
        'cajaBancoId', p_row->'cajaBancoId',
        'formaPago', p_row->'formaPago',
        'subtotal', p_row->'subtotal',
        'ivaTotal', p_row->'ivaTotal',
        'impoconsumoTotal', p_row->'impoconsumoTotal',
        'total', p_row->'total',
        'actualizadoEn', p_row->'actualizadoEn'
      ));
    WHEN 'COMMERCIAL_SALE_DETAIL' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'id', p_row->'id',
        'tenantId', p_row->'tenantId',
        'comprobanteId', p_row->'comprobanteId',
        'productoId', p_row->'productoId',
        'descripcion', p_row->'descripcion',
        'cantidad', p_row->'cantidad',
        'precioUnitario', p_row->'precioUnitario',
        'descuentoPct', p_row->'descuentoPct',
        'ivaPct', p_row->'ivaPct',
        'impoconsumoPct', p_row->'impoconsumoPct',
        'subtotalLinea', p_row->'subtotalLinea',
        'ivaValor', p_row->'ivaValor',
        'impoconsumoValor', p_row->'impoconsumoValor',
        'totalLinea', p_row->'totalLinea',
        'costoUnitario', p_row->'costoUnitario',
        'actualizadoEn', p_row->'actualizadoEn'
      ));
    WHEN 'RESTAURANT_ORDER' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'id', p_row->'id',
        'tenantId', p_row->'tenantId',
        'sessionId', p_row->'sessionId',
        'source', p_row->'source',
        'state', p_row->'state',
        'createdByUserId', p_row->'createdByUserId',
        'externalRequestId', p_row->'externalRequestId',
        'total', p_row->'total',
        'creadoEn', p_row->'creadoEn',
        'actualizadoEn', p_row->'actualizadoEn'
      ));
    WHEN 'RESTAURANT_ORDER_ITEM' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'id', p_row->'id',
        'tenantId', p_row->'tenantId',
        'orderId', p_row->'orderId',
        'menuItemId', p_row->'menuItemId',
        'productId', p_row->'productId',
        'saleDetailId', p_row->'saleDetailId',
        'description', p_row->'description',
        'quantity', p_row->'quantity',
        'unitPrice', p_row->'unitPrice',
        'lineTotal', p_row->'lineTotal',
        'station', p_row->'station',
        'seatNumber', p_row->'seatNumber',
        'notes', p_row->'notes',
        'creadoEn', p_row->'creadoEn',
        'actualizadoEn', p_row->'actualizadoEn'
      ));
    WHEN 'RESTAURANT_COMMAND' THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'id', p_row->'id',
        'tenantId', p_row->'tenantId',
        'orderId', p_row->'orderId',
        'station', p_row->'station',
        'state', p_row->'state',
        'printMode', p_row->'printMode',
        'simulationRecord', p_row->'simulationRecord',
        'creadoEn', p_row->'creadoEn',
        'actualizadoEn', p_row->'actualizadoEn'
      ));
    ELSE
      RAISE EXCEPTION 'P13_E3_ENTITY_TYPE_UNSUPPORTED:%', p_entity_type;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION p13_e3_emit_outbox()
RETURNS TRIGGER AS $$
DECLARE
  v_row JSONB;
  v_tenant_id UUID;
  v_entity_id UUID;
  v_entity_type TEXT;
  v_installation_id TEXT;
  v_version BIGINT;
  v_operation TEXT;
  v_payload JSONB;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_entity_type := TG_ARGV[0];
  v_tenant_id := NULLIF(v_row->>'tenantId', '')::uuid;
  v_entity_id := NULLIF(v_row->>'id', '')::uuid;

  IF v_tenant_id IS NULL OR v_entity_id IS NULL THEN
    RAISE EXCEPTION 'P13_E3_ROW_IDENTITY_INVALID:%:%', TG_TABLE_NAME, TG_OP;
  END IF;

  v_operation := CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END;
  v_installation_id := p13_identity_active_installation(v_tenant_id);
  v_version := p13_next_entity_version(v_tenant_id, v_entity_type, v_entity_id);
  v_payload := p13_e3_project_payload(v_entity_type, v_row);

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

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS p13_e3_sale_insert ON "ComprobanteComercial";
DROP TRIGGER IF EXISTS p13_e3_sale_update ON "ComprobanteComercial";
CREATE TRIGGER p13_e3_sale_insert
AFTER INSERT ON "ComprobanteComercial"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('COMMERCIAL_SALE');
CREATE TRIGGER p13_e3_sale_update
AFTER UPDATE ON "ComprobanteComercial"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e3_emit_outbox('COMMERCIAL_SALE');

DROP TRIGGER IF EXISTS p13_e3_sale_detail_insert ON "DetalleComprobante";
DROP TRIGGER IF EXISTS p13_e3_sale_detail_update ON "DetalleComprobante";
DROP TRIGGER IF EXISTS p13_e3_sale_detail_delete ON "DetalleComprobante";
CREATE TRIGGER p13_e3_sale_detail_insert
AFTER INSERT ON "DetalleComprobante"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('COMMERCIAL_SALE_DETAIL');
CREATE TRIGGER p13_e3_sale_detail_update
AFTER UPDATE ON "DetalleComprobante"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e3_emit_outbox('COMMERCIAL_SALE_DETAIL');
CREATE TRIGGER p13_e3_sale_detail_delete
AFTER DELETE ON "DetalleComprobante"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('COMMERCIAL_SALE_DETAIL');

DROP TRIGGER IF EXISTS p13_e3_order_insert ON "RestaurantOrder";
DROP TRIGGER IF EXISTS p13_e3_order_update ON "RestaurantOrder";
DROP TRIGGER IF EXISTS p13_e3_order_delete ON "RestaurantOrder";
CREATE TRIGGER p13_e3_order_insert
AFTER INSERT ON "RestaurantOrder"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER');
CREATE TRIGGER p13_e3_order_update
AFTER UPDATE ON "RestaurantOrder"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER');
CREATE TRIGGER p13_e3_order_delete
AFTER DELETE ON "RestaurantOrder"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER');

DROP TRIGGER IF EXISTS p13_e3_order_item_insert ON "RestaurantOrderItem";
DROP TRIGGER IF EXISTS p13_e3_order_item_update ON "RestaurantOrderItem";
DROP TRIGGER IF EXISTS p13_e3_order_item_delete ON "RestaurantOrderItem";
CREATE TRIGGER p13_e3_order_item_insert
AFTER INSERT ON "RestaurantOrderItem"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER_ITEM');
CREATE TRIGGER p13_e3_order_item_update
AFTER UPDATE ON "RestaurantOrderItem"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER_ITEM');
CREATE TRIGGER p13_e3_order_item_delete
AFTER DELETE ON "RestaurantOrderItem"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_ORDER_ITEM');

DROP TRIGGER IF EXISTS p13_e3_command_insert ON "RestaurantCommand";
DROP TRIGGER IF EXISTS p13_e3_command_update ON "RestaurantCommand";
DROP TRIGGER IF EXISTS p13_e3_command_delete ON "RestaurantCommand";
CREATE TRIGGER p13_e3_command_insert
AFTER INSERT ON "RestaurantCommand"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_COMMAND');
CREATE TRIGGER p13_e3_command_update
AFTER UPDATE ON "RestaurantCommand"
FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_COMMAND');
CREATE TRIGGER p13_e3_command_delete
AFTER DELETE ON "RestaurantCommand"
FOR EACH ROW EXECUTE FUNCTION p13_e3_emit_outbox('RESTAURANT_COMMAND');
