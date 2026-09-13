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

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
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
    if (child.exitCode !== null) throw new Error(`P13_E2_RUNTIME_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/__p13/status`, { headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (/^P13-E(?:2|3|4)$/.test(String(data.phase || ''))) return data;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`P13_E2_RUNTIME_TIMEOUT:${lastError?.message || 'unknown'}`);
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
    new Promise((_, reject) => setTimeout(() => reject(new Error('P13_E2_RUNTIME_STOP_TIMEOUT')), 5000))
  ]);
}

async function ensureActiveInstallation(client, tenantId) {
  await client.query(read('lab/restaurant-p13/sql/001-p13-sync.sql'));
  await client.query(read('lab/restaurant-p13/sql/002-p13-recovery.sql'));
  await client.query(read('lab/restaurant-p13/sql/003-p13-e1-identity-outbox.sql'));
  await client.query(read('lab/restaurant-p13/sql/004-p13-e2-table-visit-outbox.sql'));

  const active = await client.query(`
    SELECT installation_id FROM p13_installation_identity
    WHERE tenant_id=$1 AND revoked_at IS NULL
  `, [tenantId]);
  if (active.rowCount === 1) return active.rows[0].installation_id;
  assert.equal(active.rowCount, 0, 'E2 requiere máximo una instalación activa');
  const installationId = `installation-p13-e2-${crypto.randomUUID()}`;
  await client.query(`
    INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
    VALUES ($1,$2,$3,NOW())
  `, [installationId, tenantId, crypto.randomBytes(32).toString('hex')]);
  return installationId;
}

async function loginAdmin() {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo-restaurante.vantixgc.com', password: process.env.P13_ADMIN_PASSWORD }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const token = response.data?.data?.token;
  assert.ok(token, 'E2 requiere token ADMIN local');
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
    const installationId = await ensureActiveInstallation(client, tenantId);

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
    assert.equal(freeTable.rowCount, 1, 'E2 necesita una mesa demo libre');
    const table = freeTable.rows[0];

    runtime = await startRuntime();
    assert.ok(runtime.status.mutationBoundaries.includes('RESTAURANT_TABLE_VISIT'));
    assert.equal(runtime.status.allOtherBusinessMutations, 'LOCKED');

    const adminToken = await loginAdmin();
    const before = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM "RestaurantTableSession"
      WHERE "tenantId"=$1 AND "tableId"=$2 AND state IN ('ABIERTA','CUENTA_PEDIDA')
    `, [tenantId, table.id]);
    assert.equal(before.rows[0].count, 0);

    const opened = await request(`/api/v1/restaurante/mesas/${table.id}/abrir`, {
      method: 'POST',
      token: adminToken,
      body: { guestCount: 3, billingMode: 'INDIVIDUAL' }
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    assert.equal(opened.headers.get('x-vantixgc-p13-mutation-boundary'), 'RESTAURANT_TABLE_VISIT');
    const sessionId = opened.data?.data?.session?.id;
    const saleId = opened.data?.data?.sale?.id;
    assert.ok(sessionId);
    assert.ok(saleId);
    assert.equal(opened.data?.data?.session?.state, 'ABIERTA');
    assert.equal(opened.data?.data?.session?.guestCount, 3);
    assert.equal(opened.data?.data?.session?.billingMode, 'INDIVIDUAL');

    const persisted = await client.query(`
      SELECT s.id, s.state, s."guestCount", s."billingMode", s."saleId", t.state AS table_state
      FROM "RestaurantTableSession" s
      JOIN "RestaurantTable" t ON t.id=s."tableId"
      WHERE s.id=$1 AND s."tenantId"=$2
    `, [sessionId, tenantId]);
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].state, 'ABIERTA');
    assert.equal(persisted.rows[0].guestCount, 3);
    assert.equal(persisted.rows[0].billingMode, 'INDIVIDUAL');
    assert.equal(persisted.rows[0].saleId, saleId);
    assert.equal(persisted.rows[0].table_state, 'OCUPADA');

    const outbox = await client.query(`
      SELECT event_id, entity_type, entity_id, operation, entity_version, payload, status
      FROM p13_sync_outbox
      WHERE tenant_id=$1
        AND (
          (entity_type='RESTAURANT_TABLE_SESSION' AND entity_id=$2)
          OR (entity_type='RESTAURANT_TABLE' AND entity_id=$3)
        )
      ORDER BY created_at ASC
    `, [tenantId, sessionId, table.id]);
    assert.ok(outbox.rows.some((row) => row.entity_type === 'RESTAURANT_TABLE_SESSION' && row.operation === 'CREATE'));
    assert.ok(outbox.rows.some((row) => row.entity_type === 'RESTAURANT_TABLE' && row.operation === 'UPDATE'));
    for (const row of outbox.rows) {
      const serialized = JSON.stringify(row.payload).toLowerCase();
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('jwt'));
    }

    const retryOpen = await request(`/api/v1/restaurante/mesas/${table.id}/abrir`, {
      method: 'POST', token: adminToken, body: { guestCount: 3, billingMode: 'INDIVIDUAL' }
    });
    assert.equal(retryOpen.status, 409, JSON.stringify(retryOpen.data));
    const sessionCountAfterRetry = await client.query(`
      SELECT COUNT(*)::int AS count FROM "RestaurantTableSession"
      WHERE "tenantId"=$1 AND "tableId"=$2 AND state IN ('ABIERTA','CUENTA_PEDIDA')
    `, [tenantId, table.id]);
    assert.equal(sessionCountAfterRetry.rows[0].count, 1, 'Retry no puede duplicar la visita');

    const unrelatedMutation = await request('/api/v1/terceros', {
      method: 'POST', token: adminToken, body: { nombre: 'NO DEBE CREARSE E2' }
    });
    assert.equal(unrelatedMutation.status, 423);
    assert.equal(unrelatedMutation.data?.code, 'P13_BOUNDARY_LOCKED');

    await stopRuntime(runtime);
    runtime = null;
    restarted = await startRuntime();
    const tokenAfterRestart = await loginAdmin();
    const tablesAfterRestart = await request('/api/v1/restaurante/mesas', { token: tokenAfterRestart });
    assert.equal(tablesAfterRestart.status, 200, JSON.stringify(tablesAfterRestart.data));
    const listed = (tablesAfterRestart.data?.data || []).find((row) => row.id === table.id);
    assert.ok(listed, 'Mesa debe seguir visible después del reinicio local');
    assert.equal(listed.state, 'OCUPADA');
    assert.equal(listed.activeSession?.id, sessionId);

    for (const row of outbox.rows) {
      await markOutboxSent(client, row.event_id);
    }
    const sentRows = await client.query(`
      SELECT COUNT(*)::int AS count FROM p13_sync_outbox
      WHERE tenant_id=$1
        AND status='SENT'
        AND ((entity_type='RESTAURANT_TABLE_SESSION' AND entity_id=$2)
          OR (entity_type='RESTAURANT_TABLE' AND entity_id=$3))
    `, [tenantId, sessionId, table.id]);
    assert.equal(sentRows.rows[0].count, outbox.rowCount);

    const finalSessionCount = await client.query(`
      SELECT COUNT(*)::int AS count FROM "RestaurantTableSession"
      WHERE "tenantId"=$1 AND "tableId"=$2 AND state IN ('ABIERTA','CUENTA_PEDIDA')
    `, [tenantId, table.id]);
    assert.equal(finalSessionCount.rows[0].count, 1);

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-E2-TABLES-VISITS-LOCAL',
      localOpenTable: 'OK',
      visitPersistedInPostgres: 'OK',
      canonicalSaleCreated: 'OK',
      transactionalTableSessionOutbox: 'OK',
      duplicateOpenBlocked: 'OK',
      localRestartPreservesOpenVisit: 'OK',
      reconnectOutboxAckSingleEffect: 'OK',
      unrelatedBusinessMutationsLocked: 'OK',
      tenant: config.tenantSubdomain,
      table: table.code,
      sessionId,
      installationId,
      productionTouched: false
    }));
  } finally {
    if (runtime) await stopRuntime(runtime).catch(() => {});
    if (restarted) await stopRuntime(restarted).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`P13_E2_TABLES_VISITS_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
