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
        if (/^P13-E(?:1|2|3|4)$/.test(String(data.phase || ''))) return data;
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
  assert.ok(String(process.env.P13_ADMIN_PASSWORD || '').length >= 12);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let runtime = null;
  let restarted = null;

  try {
    const tenants = await client.query('SELECT id, subdomain FROM "Tenant"');
    assert.equal(tenants.rowCount, 1);
    assert.equal(tenants.rows[0].subdomain, config.tenantSubdomain);
    const tenantId = tenants.rows[0].id;
    const installationId = await prepareSchemas(client, tenantId);

    runtime = await startRuntime();
    for (const boundary of REQUIRED_E1_BOUNDARIES) {
      assert.ok(runtime.status.mutationBoundaries.includes(boundary), `Falta frontera E1 ${boundary}`);
    }
    assert.equal(runtime.status.allOtherBusinessMutations, 'LOCKED');

    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@demo-restaurante.vantixgc.com', password: process.env.P13_ADMIN_PASSWORD }
    });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
    const adminToken = adminLogin.data?.data?.token;
    assert.ok(adminToken);

    const suffix = crypto.randomBytes(5).toString('hex');
    const meseroEmail = `mesero-e1-${suffix}@example.com`;
    const meseroPassword = `P13-E1-${suffix}-Segura!`;
    const createUser = await request('/api/v1/usuarios', {
      method: 'POST', token: adminToken,
      body: { nombre: 'Mesero E1 Local', email: meseroEmail, password: meseroPassword, rol: 'MESERO', activo: true }
    });
    assert.equal(createUser.status, 201, JSON.stringify(createUser.data));
    assert.equal(createUser.headers.get('x-vantixgc-p13-mutation-boundary'), 'IDENTITY_USERS');
    const userId = createUser.data?.data?.id;
    assert.ok(userId);

    const meseroLogin = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: meseroEmail, password: meseroPassword }
    });
    assert.equal(meseroLogin.status, 200, JSON.stringify(meseroLogin.data));
    const meseroToken = meseroLogin.data?.data?.token;
    assert.ok(meseroToken);

    const forbiddenUsers = await request('/api/v1/usuarios', { token: meseroToken });
    assert.equal(forbiddenUsers.status, 403);

    const roleCode = `P13_E1_${suffix.toUpperCase()}`;
    const createRole = await request('/api/v1/seguridad/roles', {
      method: 'POST', token: adminToken,
      body: { code: roleCode, name: 'Mesero local limitado', description: 'P13-E1', vertical: 'RESTAURANTE' }
    });
    assert.equal(createRole.status, 201, JSON.stringify(createRole.data));
    const roleId = createRole.data?.data?.id;
    assert.ok(roleId);

    const setPermissions = await request(`/api/v1/seguridad/roles/${roleId}/permisos`, {
      method: 'PUT', token: adminToken,
      body: { permissionCodes: ['RESTAURANTE.VER', 'MESAS.VER'] }
    });
    assert.equal(setPermissions.status, 200, JSON.stringify(setPermissions.data));

    const assignRole = await request(`/api/v1/seguridad/usuarios/${userId}/roles`, {
      method: 'PUT', token: adminToken, body: { roleIds: [roleId] }
    });
    assert.equal(assignRole.status, 200, JSON.stringify(assignRole.data));

    const effective = await request(`/api/v1/seguridad/usuarios/${userId}/efectivos`, { token: adminToken });
    assert.equal(effective.status, 200, JSON.stringify(effective.data));
    const permissions = effective.data?.data?.permissions || [];
    assert.ok(permissions.includes('RESTAURANTE.VER'));
    assert.ok(permissions.includes('MESAS.VER'));
    assert.ok(!permissions.includes('CONFIGURACION.ADMINISTRAR'));

    const updateUser = await request(`/api/v1/usuarios/${userId}`, {
      method: 'PATCH', token: adminToken, body: { nombre: 'Mesero E1 Reinicio' }
    });
    assert.equal(updateUser.status, 200, JSON.stringify(updateUser.data));

    const unrelatedMutation = await request('/api/v1/terceros', {
      method: 'POST', token: adminToken, body: { nombre: 'NO DEBE CREARSE' }
    });
    assert.equal(unrelatedMutation.status, 423);
    assert.equal(unrelatedMutation.data?.code, 'P13_BOUNDARY_LOCKED');

    const identityEvents = await client.query(`
      SELECT operation, payload FROM p13_sync_outbox
      WHERE tenant_id=$1 AND entity_type='IDENTITY_USER' AND entity_id=$2
      ORDER BY entity_version ASC
    `, [tenantId, userId]);
    assert.ok(identityEvents.rowCount >= 2);
    assert.ok(identityEvents.rows.some((row) => row.operation === 'CREATE'));
    assert.ok(identityEvents.rows.some((row) => row.operation === 'UPDATE'));
    for (const row of identityEvents.rows) {
      const serialized = JSON.stringify(row.payload);
      assert.ok(!serialized.toLowerCase().includes('password'));
      assert.ok(!/\$2[aby]\$/.test(serialized));
    }

    await stopRuntime(runtime);
    runtime = null;
    restarted = await startRuntime();

    const loginAfterRestart = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: meseroEmail, password: meseroPassword }
    });
    assert.equal(loginAfterRestart.status, 200, JSON.stringify(loginAfterRestart.data));
    const tokenAfterRestart = loginAfterRestart.data?.data?.token;
    const sessionAfterRestart = await request('/api/v1/auth/session', { token: tokenAfterRestart });
    assert.equal(sessionAfterRestart.status, 200, JSON.stringify(sessionAfterRestart.data));
    assert.equal(sessionAfterRestart.data?.data?.user?.nombre, 'Mesero E1 Reinicio');
    assert.equal(sessionAfterRestart.data?.data?.user?.rol, 'MESERO');

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
