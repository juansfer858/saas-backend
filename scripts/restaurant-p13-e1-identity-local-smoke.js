'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const { assertLabConfig } = require('../lab/restaurant-p13/runtime');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:8790';
const REQUIRED_E1_BOUNDARIES = ['AUTH_LOGIN', 'IDENTITY_USERS', 'IDENTITY_RBAC'];

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
    if (child.exitCode !== null) throw new Error(`P13_E1_RUNTIME_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/__p13/status`, { headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (/^P13-E(?:1|2|3)$/.test(String(data.phase || ''))) return data;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`P13_E1_RUNTIME_TIMEOUT:${lastError?.message || 'unknown'}`);
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
    new Promise((_, reject) => setTimeout(() => reject(new Error('P13_E1_RUNTIME_STOP_TIMEOUT')), 5000))
  ]);
}

async function prepareSchemas(client, tenantId) {
  await client.query(read('lab/restaurant-p13/sql/001-p13-sync.sql'));
  await client.query(read('lab/restaurant-p13/sql/002-p13-recovery.sql'));
  await client.query(read('lab/restaurant-p13/sql/003-p13-e1-identity-outbox.sql'));

  const active = await client.query(`
    SELECT installation_id FROM p13_installation_identity
    WHERE tenant_id=$1 AND revoked_at IS NULL
  `, [tenantId]);
  if (active.rowCount === 1) return active.rows[0].installation_id;
  assert.equal(active.rowCount, 0, 'E1 requiere máximo una instalación activa');

  const installationId = `installation-p13-e1-${crypto.randomUUID()}`;
  await client.query(`
    INSERT INTO p13_installation_identity(installation_id, tenant_id, public_key_sha256, last_seen_at)
    VALUES ($1,$2,$3,NOW())
  `, [installationId, tenantId, crypto.randomBytes(32).toString('hex')]);
  return installationId;
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
    assert.equal(tenants.rowCount, 1, 'E1 debe operar con un solo tenant local');
    assert.equal(tenants.rows[0].subdomain, config.tenantSubdomain);
    const tenantId = tenants.rows[0].id;
    const installationId = await prepareSchemas(client, tenantId);

    const localUsers = await client.query(`
      SELECT id, email, rol, activo FROM "User"
      WHERE "tenantId"=$1 AND email IN ('admin@demo-restaurante.vantixgc.com','mesero@demo-restaurante.vantixgc.com')
      ORDER BY email
    `, [tenantId]);
    assert.equal(localUsers.rowCount, 2, 'Bootstrap local debe tener ADMIN y MESERO');

    const admin = localUsers.rows.find((row) => row.email === 'admin@demo-restaurante.vantixgc.com');
    const waiter = localUsers.rows.find((row) => row.email === 'mesero@demo-restaurante.vantixgc.com');
    assert.ok(admin?.activo);
    assert.ok(waiter?.activo);

    runtime = await startRuntime();
    for (const boundary of REQUIRED_E1_BOUNDARIES) assert.ok(runtime.status.mutationBoundaries.includes(boundary), `Falta frontera E1 ${boundary}`);
    assert.equal(runtime.status.allOtherBusinessMutations, 'LOCKED');

    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: process.env.P13_ADMIN_PASSWORD }
    });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
    const adminToken = adminLogin.data?.data?.token;
    assert.ok(adminToken, 'ADMIN debe autenticar localmente');

    const waiterLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: waiter.email, password: 'Mesero123!' }
    });
    assert.equal(waiterLogin.status, 200, JSON.stringify(waiterLogin.data));
    const waiterToken = waiterLogin.data?.data?.token;
    assert.ok(waiterToken, 'MESERO debe autenticar localmente');

    const adminContext = await request('/api/v1/restaurante/ui-context', { token: adminToken });
    assert.equal(adminContext.status, 200, JSON.stringify(adminContext.data));
    const waiterContext = await request('/api/v1/restaurante/ui-context', { token: waiterToken });
    assert.equal(waiterContext.status, 200, JSON.stringify(waiterContext.data));
    assert.equal(adminContext.data?.data?.user?.rol, 'ADMIN');
    assert.equal(waiterContext.data?.data?.user?.rol, 'MESERO');

    const before = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_outbox WHERE tenant_id=$1', [tenantId]);
    const unique = crypto.randomUUID().slice(0, 8);
    const createUser = await request('/api/v1/usuarios', {
      method: 'POST',
      token: adminToken,
      body: {
        nombre: `Auxiliar P13 ${unique}`,
        email: `aux-${unique}@p13.local`,
        password: 'P13LocalPass123!',
        rol: 'MESERO'
      }
    });
    assert.equal(createUser.status, 201, JSON.stringify(createUser.data));
    const newUserId = createUser.data?.data?.id;
    assert.ok(newUserId);

    const userEvents = await client.query(`
      SELECT event_id, entity_type, operation, payload
      FROM p13_sync_outbox
      WHERE tenant_id=$1 AND entity_type='USER' AND entity_id=$2
      ORDER BY created_at
    `, [tenantId, newUserId]);
    assert.ok(userEvents.rowCount >= 1, 'Alta local de usuario debe emitir outbox');
    for (const row of userEvents.rows) {
      const serialized = JSON.stringify(row.payload).toLowerCase();
      assert.ok(!serialized.includes('passwordhash'), 'Outbox jamás debe contener passwordHash');
      assert.ok(!serialized.includes('p13localpass123'), 'Outbox jamás debe contener contraseña');
    }

    const locked = await request('/api/v1/terceros', {
      method: 'POST', token: adminToken, body: { nombre: 'NO DEBE CREARSE' }
    });
    assert.equal(locked.status, 423, JSON.stringify(locked.data));
    assert.equal(locked.data?.code, 'P13_BOUNDARY_LOCKED');

    await stopRuntime(runtime);
    runtime = null;
    restarted = await startRuntime();
    const loginAfterRestart = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: process.env.P13_ADMIN_PASSWORD }
    });
    assert.equal(loginAfterRestart.status, 200, JSON.stringify(loginAfterRestart.data));
    assert.ok(loginAfterRestart.data?.data?.token);

    const after = await client.query('SELECT COUNT(*)::int AS count FROM p13_sync_outbox WHERE tenant_id=$1', [tenantId]);
    assert.ok(after.rows[0].count > before.rows[0].count, 'E1 debe agregar eventos transaccionales locales');

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-E1-IDENTITY-LOCAL',
      runtimePhase: restarted.status.phase,
      localAdminLogin: 'OK',
      localMeseroLogin: 'OK',
      rolesAndPermissionsLocal: 'OK',
      transactionalIdentityOutbox: 'OK',
      passwordHashExcludedFromSyncPayload: 'OK',
      localRestartWithoutCore: 'OK',
      unrelatedBusinessMutationsLocked: 'OK',
      tenant: config.tenantSubdomain,
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
  console.error(`P13_E1_IDENTITY_LOCAL_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
