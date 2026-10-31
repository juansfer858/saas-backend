'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const { assertLabConfig } = require('../lab/restaurant-p13/runtime');
const { buildEscPos, RESTAURANT_COMMAND_LARGE_V2 } = require('../edge/print-spooler/escpos');
const {
  claimNextPrintJob,
  markPrintFailed,
  markPrintSucceeded,
  recoverStaleClaims
} = require('../lab/restaurant-p13/printing/repository');
const { markOutboxSent } = require('../lab/restaurant-p13/sync/repository');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:8790';

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

async function request(pathname, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = { accept: 'application/json', 'x-tenant-subdomain': process.env.P13_TENANT_SUBDOMAIN };
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
    if (child.exitCode !== null) throw new Error(`P13_E4_RUNTIME_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/__p13/status`, { headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (data.phase === 'P13-E4') return data;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`P13_E4_RUNTIME_TIMEOUT:${lastError?.message || 'unknown'}`);
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
    new Promise((_, reject) => setTimeout(() => reject(new Error('P13_E4_RUNTIME_STOP_TIMEOUT')), 5000))
  ]);
}

async function prepareSchemas(client, tenantId) {
  for (const file of [
    'lab/restaurant-p13/sql/001-p13-sync.sql',
    'lab/restaurant-p13/sql/002-p13-recovery.sql',
    'lab/restaurant-p13/sql/003-p13-e1-identity-outbox.sql',
    'lab/restaurant-p13/sql/004-p13-e2-table-visit-outbox.sql'
  ]) await client.query(read(file));

  const active = await client.query(`
    SELECT installation_id FROM p13_installation_identity
    WHERE tenant_id=$1 AND revoked_at IS NULL
  `, [tenantId]);
  assert.ok(active.rowCount <= 1);
  let installationId = active.rows[0]?.installation_id || null;
  if (!installationId) {
    installationId = `installation-p13-e4-${crypto.randomUUID()}`;
    await client.query(`
      INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
      VALUES ($1,$2,$3,NOW())
    `, [installationId, tenantId, crypto.randomBytes(32).toString('hex')]);
  }

  await client.query(read('lab/restaurant-p13/sql/005-p13-e3-order-person-outbox.sql'));
  await client.query(read('lab/restaurant-p13/sql/006-p13-e4-kds-print-queue.sql'));
  return installationId;
}

async function loginAdmin() {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo-restaurante.vantixgc.com', password: process.env.P13_ADMIN_PASSWORD }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(response.data?.data?.token);
  return response.data.data.token;
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
    const tenantId = tenants.rows[0].id;
    const installationId = await prepareSchemas(client, tenantId);
    await recoverStaleClaims(client, tenantId, 10);
    const startedAt = (await client.query('SELECT NOW() AS at')).rows[0].at;

    const freeTable = await client.query(`
      SELECT t.id, t.code, t.name
      FROM "RestaurantTable" t
      WHERE t."tenantId"=$1 AND t.active=true
        AND NOT EXISTS (
          SELECT 1 FROM "RestaurantTableSession" s
          WHERE s."tenantId"=t."tenantId" AND s."tableId"=t.id
            AND s.state IN ('ABIERTA','CUENTA_PEDIDA')
        )
      ORDER BY t.code ASC LIMIT 1
    `, [tenantId]);
    assert.equal(freeTable.rowCount, 1, 'E4 necesita mesa demo libre');
    const table = freeTable.rows[0];

    runtime = await startRuntime();
    assert.ok(runtime.status.mutationBoundaries.includes('RESTAURANT_KDS_COMMAND_STATE'));
    assert.equal(runtime.status.allOtherBusinessMutations, 'LOCKED');
    const token = await loginAdmin();

    const menuResponse = await request('/api/v1/restaurante/menu', { token });
    assert.equal(menuResponse.status, 200, JSON.stringify(menuResponse.data));
    const menuRows = Array.isArray(menuResponse.data?.data) ? menuResponse.data.data : [];
    const menuItem = menuRows.find((row) => row?.active !== false && row?.product && !row?.warning);
    assert.ok(menuItem?.id);

    const opened = await request(`/api/v1/restaurante/mesas/${table.id}/abrir`, {
      method: 'POST', token, body: { guestCount: 2, billingMode: 'INDIVIDUAL' }
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const sessionId = opened.data?.data?.session?.id;
    assert.ok(sessionId);

    const draft = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/items/${menuItem.id}`, {
      method: 'PUT', token, body: { quantity: 2, seatNumber: 2 }
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.data));
    const orderId = draft.data?.data?.order?.id;
    const item = (draft.data?.data?.order?.items || []).find((row) => row.menuItemId === menuItem.id);
    assert.ok(orderId && item?.id);

    const meta = await request(`/api/v1/restaurante/sesiones/${sessionId}/items/${item.id}`, {
      method: 'PATCH', token, body: { seatNumber: 2, notes: 'SIN CEBOLLA' }
    });
    assert.equal(meta.status, 200, JSON.stringify(meta.data));

    const sent = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, {
      method: 'POST', token, body: {}
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data?.data?.state, 'ENVIADO');
    const commands = sent.data?.data?.commands || [];
    assert.equal(commands.length, 1, 'E4 usa una línea/estación para validar una sola impresión');
    const command = commands[0];

    const queued = await client.query(`
      SELECT * FROM p13_local_print_queue
      WHERE tenant_id=$1 AND command_id=$2
    `, [tenantId, command.id]);
    assert.equal(queued.rowCount, 1, 'Comanda debe crear exactamente un trabajo local durable');
    assert.equal(queued.rows[0].status, 'PENDING');
    assert.equal(queued.rows[0].attempts, 0);
    assert.equal(queued.rows[0].job.template, RESTAURANT_COMMAND_LARGE_V2);

    await stopRuntime(runtime);
    runtime = null;
    restarted = await startRuntime();
    const tokenAfterRestart = await loginAdmin();

    const queueAfterRestart = await client.query(`
      SELECT status, attempts FROM p13_local_print_queue
      WHERE tenant_id=$1 AND command_id=$2
    `, [tenantId, command.id]);
    assert.equal(queueAfterRestart.rows[0].status, 'PENDING');

    const kds = await request(`/api/v1/restaurante/v2/kds?station=${encodeURIComponent(command.station)}`, { token: tokenAfterRestart });
    assert.equal(kds.status, 200, JSON.stringify(kds.data));
    const visible = (kds.data?.data?.commands || []).find((row) => row.id === command.id);
    assert.ok(visible, 'La comanda debe seguir visible en KDS tras reinicio local');
    assert.equal(visible.state, 'PENDIENTE');

    const firstClaim = await claimNextPrintJob(client, tenantId);
    assert.equal(firstClaim.command_id, command.id);
    assert.equal(firstClaim.status, 'PRINTING');
    assert.equal(firstClaim.attempts, 1);
    const escpos = buildEscPos(firstClaim.job);
    assert.ok(Buffer.isBuffer(escpos));
    assert.ok(escpos.length > 40);
    assert.ok(escpos.includes(Buffer.from('PERSONA 2')));
    assert.ok(escpos.includes(Buffer.from('SIN CEBOLLA')));

    const failed = await markPrintFailed(client, tenantId, firstClaim.job_id, 'SIMULATED_PRINTER_OFFLINE', 0);
    assert.equal(failed.status, 'FAILED');
    const retryClaim = await claimNextPrintJob(client, tenantId);
    assert.equal(retryClaim.job_id, firstClaim.job_id);
    assert.equal(retryClaim.attempts, 2);
    const printed = await markPrintSucceeded(client, tenantId, retryClaim.job_id);
    assert.equal(printed.status, 'PRINTED');
    const duplicateAck = await markPrintSucceeded(client, tenantId, retryClaim.job_id);
    assert.equal(duplicateAck.status, 'PRINTED');
    const oneQueueRow = await client.query(`
      SELECT COUNT(*)::int AS count FROM p13_local_print_queue
      WHERE tenant_id=$1 AND command_id=$2
    `, [tenantId, command.id]);
    assert.equal(oneQueueRow.rows[0].count, 1, 'Retry/ack nunca puede duplicar el trabajo de impresión');

    const transitions = [
      ['EN_PREPARACION', 'EN_PREPARACION'],
      ['LISTA', 'LISTO'],
      ['ENTREGADA', 'ENTREGADO']
    ];
    for (const [commandState, orderState] of transitions) {
      const changed = await request(`/api/v1/restaurante/v2/kds/comandas/${command.id}`, {
        method: 'PATCH', token: tokenAfterRestart, body: { state: commandState }
      });
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal(changed.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_KDS_COMMAND_STATE');
      assert.equal(changed.data?.data?.command?.command?.state || changed.data?.data?.command?.state, commandState);
      const persisted = await client.query(`
        SELECT c.state AS command_state, o.state AS order_state
        FROM "RestaurantCommand" c JOIN "RestaurantOrder" o ON o.id=c."orderId"
        WHERE c."tenantId"=$1 AND c.id=$2
      `, [tenantId, command.id]);
      assert.equal(persisted.rows[0].command_state, commandState);
      assert.equal(persisted.rows[0].order_state, orderState);
    }

    const finalKds = await request(`/api/v1/restaurante/v2/kds?station=${encodeURIComponent(command.station)}`, { token: tokenAfterRestart });
    assert.equal(finalKds.status, 200, JSON.stringify(finalKds.data));
    assert.ok(!(finalKds.data?.data?.commands || []).some((row) => row.id === command.id), 'Comanda ENTREGADA sale de la cola activa KDS');

    const stateEvents = await client.query(`
      SELECT event_id, entity_type, entity_id, operation, payload, status
      FROM p13_sync_outbox
      WHERE tenant_id=$1 AND created_at >= $2
        AND ((entity_type='RESTAURANT_COMMAND' AND entity_id=$3)
          OR (entity_type='RESTAURANT_ORDER' AND entity_id=$4))
      ORDER BY created_at ASC
    `, [tenantId, startedAt, command.id, orderId]);
    assert.ok(stateEvents.rows.filter((row) => row.entity_type === 'RESTAURANT_COMMAND' && row.operation === 'UPDATE').length >= 3);
    assert.ok(stateEvents.rows.filter((row) => row.entity_type === 'RESTAURANT_ORDER' && row.operation === 'UPDATE').length >= 3);
    for (const row of stateEvents.rows) await markOutboxSent(client, row.event_id);
    const sentEvents = await client.query(`
      SELECT COUNT(*)::int AS count FROM p13_sync_outbox
      WHERE tenant_id=$1 AND event_id=ANY($2::text[]) AND status='SENT'
    `, [tenantId, stateEvents.rows.map((row) => row.event_id)]);
    assert.equal(sentEvents.rows[0].count, stateEvents.rowCount);

    const unrelatedMutation = await request('/api/v1/terceros', {
      method: 'POST', token: tokenAfterRestart, body: { nombre: 'NO DEBE CREARSE E4' }
    });
    assert.equal(unrelatedMutation.status, 423);
    assert.equal(unrelatedMutation.data?.code, 'P13_BOUNDARY_LOCKED');

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-E4-KDS-PRINT-LOCAL',
      kdsVisibleAfterRestart: 'OK',
      kdsStateMachine: 'PENDIENTE_EN_PREPARACION_LISTA_ENTREGADA_OK',
      orderAggregateStates: 'OK',
      durableLocalPrintQueue: 'OK',
      exactEscPosRendererReused: 'OK',
      printRetryWithoutDuplicate: 'OK',
      transactionalKdsOutbox: 'OK',
      unrelatedBusinessMutationsLocked: 'OK',
      tenant: config.tenantSubdomain,
      table: table.code,
      station: command.station,
      commandId: command.id,
      orderId,
      installationId,
      physicalPrinterContacted: false,
      productionTouched: false
    }));
  } finally {
    if (runtime) await stopRuntime(runtime).catch(() => {});
    if (restarted) await stopRuntime(restarted).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`P13_E4_KDS_PRINT_QUEUE_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
