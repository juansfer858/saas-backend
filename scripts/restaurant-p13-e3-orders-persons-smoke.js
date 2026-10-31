'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const { assertLabConfig } = require('../lab/restaurant-p13/runtime');
const { markOutboxSent } = require('../lab/restaurant-p13/sync/repository');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:8790';
const E3_ENTITY_TYPES = [
  'COMMERCIAL_SALE',
  'COMMERCIAL_SALE_DETAIL',
  'RESTAURANT_ORDER',
  'RESTAURANT_ORDER_ITEM',
  'RESTAURANT_COMMAND'
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function errorCode(data) {
  return data?.code || data?.error?.code || null;
}

async function request(pathname, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = {
    accept: 'application/json',
    'x-tenant-subdomain': process.env.P13_TENANT_SUBDOMAIN
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }
  return { status: response.status, headers: response.headers, data };
}

async function waitForRuntime(child) {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`P13_E3_RUNTIME_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/__p13/status`, { headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (/^P13-E(?:3|4)$/.test(String(data.phase || ''))) return data;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`P13_E3_RUNTIME_TIMEOUT:${lastError?.message || 'unknown'}`);
}

async function startRuntime() {
  const child = spawn(process.execPath, ['lab/restaurant-p13/runtime.js'], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    const status = await waitForRuntime(child);
    return { child, status };
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\nstdout=${stdout}\nstderr=${stderr}`);
  }
}

async function stopRuntime(runtime) {
  if (!runtime?.child || runtime.child.exitCode !== null) return;
  runtime.child.kill('SIGTERM');
  await Promise.race([
    once(runtime.child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('P13_E3_RUNTIME_STOP_TIMEOUT')), 5000))
  ]);
}

async function prepareSyncAndInstallation(client, tenantId) {
  await client.query(read('lab/restaurant-p13/sql/001-p13-sync.sql'));
  await client.query(read('lab/restaurant-p13/sql/002-p13-recovery.sql'));
  await client.query(read('lab/restaurant-p13/sql/003-p13-e1-identity-outbox.sql'));
  await client.query(read('lab/restaurant-p13/sql/004-p13-e2-table-visit-outbox.sql'));

  const active = await client.query(`
    SELECT installation_id FROM p13_installation_identity
    WHERE tenant_id=$1 AND revoked_at IS NULL
  `, [tenantId]);
  assert.ok(active.rowCount <= 1, 'E3 requiere máximo una instalación activa');
  let installationId = active.rows[0]?.installation_id || null;
  if (!installationId) {
    installationId = `installation-p13-e3-${crypto.randomUUID()}`;
    await client.query(`
      INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
      VALUES ($1,$2,$3,NOW())
    `, [installationId, tenantId, crypto.randomBytes(32).toString('hex')]);
  }

  await client.query(read('lab/restaurant-p13/sql/005-p13-e3-order-person-outbox.sql'));
  return installationId;
}

async function loginAdmin() {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo-restaurante.vantixgc.com', password: process.env.P13_ADMIN_PASSWORD }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const token = response.data?.data?.token;
  assert.ok(token, 'E3 requiere token ADMIN local');
  return token;
}

async function main() {
  const config = assertLabConfig(process.env);
  assert.equal(config.tenantSubdomain, 'demo-restaurante');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let runtime = null;
  let restarted = null;

  try {
    const tenants = await client.query('SELECT id, subdomain FROM "Tenant"');
    assert.equal(tenants.rowCount, 1);
    assert.equal(tenants.rows[0].subdomain, config.tenantSubdomain);
    const tenantId = tenants.rows[0].id;
    const installationId = await prepareSyncAndInstallation(client, tenantId);
    const started = await client.query('SELECT NOW() AS at');
    const startedAt = started.rows[0].at;

    const freeTable = await client.query(`
      SELECT t.id, t.code, t.name
      FROM "RestaurantTable" t
      WHERE t."tenantId"=$1
        AND t.active=true
        AND NOT EXISTS (
          SELECT 1 FROM "RestaurantTableSession" s
          WHERE s."tenantId"=t."tenantId"
            AND s."tableId"=t.id
            AND s.state IN ('ABIERTA','CUENTA_PEDIDA')
        )
      ORDER BY t.code ASC
      LIMIT 1
    `, [tenantId]);
    assert.equal(freeTable.rowCount, 1, 'E3 necesita una mesa demo libre');
    const table = freeTable.rows[0];

    runtime = await startRuntime();
    for (const boundary of [
      'RESTAURANT_TABLE_VISIT',
      'RESTAURANT_ORDER_PERSON',
      'RESTAURANT_ORDER_DRAFT',
      'RESTAURANT_ORDER_ITEM_META',
      'RESTAURANT_ORDER_SEND'
    ]) assert.ok(runtime.status.mutationBoundaries.includes(boundary), `Falta frontera ${boundary}`);
    assert.equal(runtime.status.allOtherBusinessMutations, 'LOCKED');

    const adminToken = await loginAdmin();

    const menuResponse = await request('/api/v1/restaurante/menu', { token: adminToken });
    assert.equal(menuResponse.status, 200, JSON.stringify(menuResponse.data));
    const menuRows = Array.isArray(menuResponse.data?.data) ? menuResponse.data.data : [];
    const menuItem = menuRows.find((row) => row?.active !== false && row?.product && !row?.warning);
    assert.ok(menuItem?.id, 'E3 necesita un producto de menú vendible en el tenant demo');

    const opened = await request(`/api/v1/restaurante/mesas/${table.id}/abrir`, {
      method: 'POST',
      token: adminToken,
      body: { guestCount: 2, billingMode: 'INDIVIDUAL' }
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const sessionId = opened.data?.data?.session?.id;
    const saleId = opened.data?.data?.sale?.id;
    assert.ok(sessionId);
    assert.ok(saleId);

    const serviceSetup = await request(`/api/v1/restaurante/sesiones/${sessionId}/servicio`, {
      method: 'PATCH',
      token: adminToken,
      body: { billingMode: 'INDIVIDUAL', guestCount: 3 }
    });
    assert.equal(serviceSetup.status, 200, JSON.stringify(serviceSetup.data));
    assert.equal(serviceSetup.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_ORDER_PERSON');
    assert.equal(serviceSetup.data?.data?.session?.guestCount, 3);
    assert.equal(serviceSetup.data?.data?.session?.billingMode, 'INDIVIDUAL');

    const draft = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/items/${menuItem.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { quantity: 2, seatNumber: 2 }
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.data));
    assert.equal(draft.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_ORDER_DRAFT');
    const orderId = draft.data?.data?.order?.id;
    const draftItems = draft.data?.data?.order?.items || [];
    const item = draftItems.find((row) => row.menuItemId === menuItem.id && Number(row.seatNumber) === 2);
    assert.ok(orderId, 'E3 debe crear pedido borrador local');
    assert.ok(item?.id, 'E3 debe crear línea para Persona 2');

    const itemMeta = await request(`/api/v1/restaurante/sesiones/${sessionId}/items/${item.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { seatNumber: 2, notes: 'SIN CEBOLLA' }
    });
    assert.equal(itemMeta.status, 200, JSON.stringify(itemMeta.data));
    assert.equal(itemMeta.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_ORDER_ITEM_META');
    assert.equal(itemMeta.data?.data?.item?.seatNumber, 2);
    assert.equal(itemMeta.data?.data?.item?.notes, 'SIN CEBOLLA');

    const persisted = await client.query(`
      SELECT o.id, o.state, o."sessionId", i.id AS item_id, i."seatNumber", i.notes,
             i.quantity::text AS quantity, i."saleDetailId"
      FROM "RestaurantOrder" o
      JOIN "RestaurantOrderItem" i ON i."orderId"=o.id AND i."tenantId"=o."tenantId"
      WHERE o.id=$1 AND o."tenantId"=$2
    `, [orderId, tenantId]);
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].state, 'BORRADOR');
    assert.equal(persisted.rows[0].sessionId, sessionId);
    assert.equal(Number(persisted.rows[0].seatNumber), 2);
    assert.equal(persisted.rows[0].notes, 'SIN CEBOLLA');
    assert.equal(Number(persisted.rows[0].quantity), 2);
    assert.ok(persisted.rows[0].saleDetailId);

    const sent = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, {
      method: 'POST', token: adminToken, body: {}
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_ORDER_SEND');
    assert.equal(sent.data?.data?.id, orderId);
    assert.equal(sent.data?.data?.state, 'ENVIADO');
    const commands = sent.data?.data?.commands || [];
    assert.ok(commands.length >= 1, 'E3 debe crear al menos una comanda local');

    const commandRows = await client.query(`
      SELECT id, station, state, "simulationRecord"
      FROM "RestaurantCommand"
      WHERE "tenantId"=$1 AND "orderId"=$2
      ORDER BY "creadoEn" ASC
    `, [tenantId, orderId]);
    assert.equal(commandRows.rowCount, commands.length);
    const commandPayload = JSON.stringify(commandRows.rows.map((row) => row.simulationRecord));
    assert.ok(commandPayload.includes('Persona 2'), 'Comanda debe conservar Persona 2');
    assert.ok(commandPayload.includes('SIN CEBOLLA'), 'Comanda debe conservar nota de cocina');

    const e3Outbox = await client.query(`
      SELECT event_id, entity_type, entity_id, operation, entity_version, payload, status
      FROM p13_sync_outbox
      WHERE tenant_id=$1
        AND created_at >= $2
        AND entity_type = ANY($3::text[])
      ORDER BY created_at ASC, entity_version ASC
    `, [tenantId, startedAt, E3_ENTITY_TYPES]);
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'COMMERCIAL_SALE' && row.entity_id === saleId));
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'COMMERCIAL_SALE_DETAIL'));
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'RESTAURANT_ORDER' && row.entity_id === orderId && row.operation === 'CREATE'));
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'RESTAURANT_ORDER' && row.entity_id === orderId && row.operation === 'UPDATE'));
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'RESTAURANT_ORDER_ITEM' && row.entity_id === item.id));
    assert.ok(e3Outbox.rows.some((row) => row.entity_type === 'RESTAURANT_COMMAND' && row.operation === 'CREATE'));
    for (const row of e3Outbox.rows) {
      const serialized = JSON.stringify(row.payload).toLowerCase();
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('jwt'));
    }

    const commandsBeforeRetry = await client.query(`
      SELECT COUNT(*)::int AS count FROM "RestaurantCommand"
      WHERE "tenantId"=$1 AND "orderId"=$2
    `, [tenantId, orderId]);
    const retrySend = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, {
      method: 'POST', token: adminToken, body: {}
    });
    assert.equal(retrySend.status, 409, JSON.stringify(retrySend.data));
    assert.equal(errorCode(retrySend.data), 'RESTAURANT_DRAFT_ORDER_NOT_FOUND');
    const commandsAfterRetry = await client.query(`
      SELECT COUNT(*)::int AS count FROM "RestaurantCommand"
      WHERE "tenantId"=$1 AND "orderId"=$2
    `, [tenantId, orderId]);
    assert.equal(commandsAfterRetry.rows[0].count, commandsBeforeRetry.rows[0].count, 'Retry no puede duplicar comandas');

    const unrelatedMutation = await request('/api/v1/terceros', {
      method: 'POST', token: adminToken, body: { nombre: 'NO DEBE CREARSE E3' }
    });
    assert.equal(unrelatedMutation.status, 423);
    assert.equal(unrelatedMutation.data?.code, 'P13_BOUNDARY_LOCKED');

    await stopRuntime(runtime);
    runtime = null;
    restarted = await startRuntime();
    const tokenAfterRestart = await loginAdmin();
    const serviceAfterRestart = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador`, { token: tokenAfterRestart });
    assert.equal(serviceAfterRestart.status, 200, JSON.stringify(serviceAfterRestart.data));
    assert.equal(serviceAfterRestart.data?.data?.service?.orderCount, 1);
    const visibleItem = (serviceAfterRestart.data?.data?.service?.allItems || []).find((row) => row.id === item.id);
    assert.ok(visibleItem, 'Pedido enviado debe seguir visible después del reinicio local');
    assert.equal(Number(visibleItem.seatNumber), 2);
    assert.equal(visibleItem.notes, 'SIN CEBOLLA');

    for (const row of e3Outbox.rows) await markOutboxSent(client, row.event_id);
    const sentEvents = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM p13_sync_outbox
      WHERE tenant_id=$1
        AND event_id = ANY($2::text[])
        AND status='SENT'
    `, [tenantId, e3Outbox.rows.map((row) => row.event_id)]);
    assert.equal(sentEvents.rows[0].count, e3Outbox.rowCount, 'Ack debe marcar cada evento E3 una sola vez');

    const finalOrder = await client.query(`
      SELECT state FROM "RestaurantOrder" WHERE id=$1 AND "tenantId"=$2
    `, [orderId, tenantId]);
    assert.equal(finalOrder.rows[0].state, 'ENVIADO');

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-E3-ORDERS-PERSONS-LOCAL',
      localIndividualService: 'OK',
      localDraftOrder: 'OK',
      personAssignment: 'PERSONA_2_OK',
      kitchenNotes: 'OK',
      canonicalSaleDetail: 'OK',
      localCommandCreation: 'OK',
      transactionalE3Outbox: 'OK',
      duplicateSendBlocked: 'OK',
      localRestartPreservesSentOrder: 'OK',
      reconnectOutboxAckSingleEffect: 'OK',
      unrelatedBusinessMutationsLocked: 'OK',
      tenant: config.tenantSubdomain,
      table: table.code,
      sessionId,
      orderId,
      installationId,
      physicalPrintingInvoked: false,
      productionTouched: false
    }));
  } finally {
    if (runtime) await stopRuntime(runtime).catch(() => {});
    if (restarted) await stopRuntime(restarted).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`P13_E3_ORDERS_PERSONS_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
