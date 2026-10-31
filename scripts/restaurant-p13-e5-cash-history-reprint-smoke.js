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

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

async function request(pathname, { method = 'GET', token = null, body = undefined, redirect = 'follow' } = {}) {
  const headers = { accept: 'application/json', 'x-tenant-subdomain': process.env.P13_TENANT_SUBDOMAIN };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method, headers, redirect,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, headers: response.headers, data, text, location: response.headers.get('location') };
}

async function waitForRuntime(child) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`P13_E5_RUNTIME_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/__p13/status`, { headers: { accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (data.cashLocal === 'MINIMAL_OPERATION_HISTORY_REPRINT') return data;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`P13_E5_RUNTIME_TIMEOUT:${lastError?.message || 'unknown'}`);
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
  try { return { child, status: await waitForRuntime(child), stdout: () => stdout, stderr: () => stderr }; }
  catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\nstdout=${stdout}\nstderr=${stderr}`);
  }
}

async function stopRuntime(runtime) {
  if (!runtime?.child || runtime.child.exitCode !== null) return;
  runtime.child.kill('SIGTERM');
  await Promise.race([
    once(runtime.child, 'exit'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('P13_E5_RUNTIME_STOP_TIMEOUT')), 5000))
  ]);
}

async function prepareSchemas(client, tenantId) {
  for (const file of [
    'lab/restaurant-p13/sql/001-p13-sync.sql',
    'lab/restaurant-p13/sql/002-p13-recovery.sql',
    'lab/restaurant-p13/sql/003-p13-e1-identity-outbox.sql',
    'lab/restaurant-p13/sql/004-p13-e2-table-visit-outbox.sql',
    'lab/restaurant-p13/sql/005-p13-e3-order-person-outbox.sql',
    'lab/restaurant-p13/sql/006-p13-e4-kds-print-queue.sql',
    'lab/restaurant-p13/sql/007-p13-e5-cash-reprint.sql'
  ]) await client.query(read(file));

  const active = await client.query(`SELECT installation_id FROM p13_installation_identity WHERE tenant_id=$1 AND revoked_at IS NULL`, [tenantId]);
  assert.ok(active.rowCount <= 1, 'E5 requiere máximo una instalación activa');
  if (active.rowCount === 1) return active.rows[0].installation_id;
  const installationId = `installation-p13-e5-${crypto.randomUUID()}`;
  await client.query(`INSERT INTO p13_installation_identity(installation_id,tenant_id,public_key_sha256,last_seen_at) VALUES($1,$2,$3,NOW())`, [installationId, tenantId, crypto.randomBytes(32).toString('hex')]);
  return installationId;
}

async function loginAdmin() {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo-restaurante.vantixgc.com', password: process.env.P13_ADMIN_PASSWORD }
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const token = response.data?.data?.token;
  assert.ok(token, 'E5 requiere token ADMIN local');
  return token;
}

function quoteIdent(value) { return `"${String(value).replace(/"/g, '""')}"`; }

async function canonicalTenantDigest(client, tenantId) {
  const tables = await client.query(`
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenantId'
    ORDER BY table_name
  `);
  const digest = {};
  for (const { table_name: table } of tables.rows) {
    const ident = quoteIdent(table);
    const result = await client.query(`
      SELECT COUNT(*)::int AS count,
             md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')) AS digest
      FROM (
        SELECT md5(row_to_json(t)::text) AS row_hash
        FROM ${ident} t
        WHERE t."tenantId"=$1
      ) q
    `, [tenantId]);
    digest[table] = result.rows[0];
  }
  return digest;
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

    const freeTable = await client.query(`
      SELECT t.id,t.code,t.name FROM "RestaurantTable" t
      WHERE t."tenantId"=$1 AND t.active=true
        AND NOT EXISTS (SELECT 1 FROM "RestaurantTableSession" s WHERE s."tenantId"=t."tenantId" AND s."tableId"=t.id AND s.state IN ('ABIERTA','CUENTA_PEDIDA'))
      ORDER BY t.code ASC LIMIT 1
    `, [tenantId]);
    assert.equal(freeTable.rowCount, 1, 'E5 necesita una mesa libre');
    const table = freeTable.rows[0];

    runtime = await startRuntime();
    assert.equal(runtime.status.localSurface, 'RESTAURANT_CONTROL_CENTER_ONLY');
    assert.equal(runtime.status.superCoreUi, 'CLOUD_ONLY');
    for (const boundary of ['RESTAURANT_ACCOUNT_TO_CASH','RESTAURANT_CASH_SHIFT_OPEN','RESTAURANT_CASH_SHIFT_CLOSE','RESTAURANT_CASH_CHARGE','RESTAURANT_CASH_REPRINT']) {
      assert.ok(runtime.status.mutationBoundaries.includes(boundary), `Falta frontera ${boundary}`);
    }

    const root = await request('/', { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.location, '/app/centro-de-control-v2');
    const superCore = await request('/app/dashboard');
    assert.equal(superCore.status, 404);
    assert.equal(superCore.data?.code, 'P13_SUPER_CORE_UI_CLOUD_ONLY');

    const adminToken = await loginAdmin();
    const cashHtml = await request('/app/restaurante-v2/caja', { token: adminToken });
    assert.equal(cashHtml.status, 200);
    assert.ok(cashHtml.text.includes('VANTIX_RESTAURANT_P13_E5_CASH_HISTORY'), 'Caja local debe montar Últimos cobros');
    assert.ok(cashHtml.text.includes('/app/p13-local-cash-history.js?v=e5'));

    const menu = await request('/api/v1/restaurante/menu', { token: adminToken });
    assert.equal(menu.status, 200, JSON.stringify(menu.data));
    const menuItem = (menu.data?.data || []).find((row) => row?.active !== false && row?.product && !row?.warning);
    assert.ok(menuItem?.id, 'E5 necesita producto vendible');

    const opened = await request(`/api/v1/restaurante/mesas/${table.id}/abrir`, {
      method: 'POST', token: adminToken, body: { guestCount: 2, billingMode: 'CONJUNTA' }
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const sessionId = opened.data?.data?.session?.id;
    assert.ok(sessionId);

    const draft = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/items/${menuItem.id}`, {
      method: 'PUT', token: adminToken, body: { quantity: 2 }
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.data));
    const item = draft.data?.data?.order?.items?.find((row) => row.menuItemId === menuItem.id);
    assert.ok(item?.id);
    const note = await request(`/api/v1/restaurante/sesiones/${sessionId}/items/${item.id}`, {
      method: 'PATCH', token: adminToken, body: { notes: 'E5 LOCAL' }
    });
    assert.equal(note.status, 200, JSON.stringify(note.data));

    const sent = await request(`/api/v1/restaurante/sesiones/${sessionId}/pedido-borrador/enviar`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const commands = sent.data?.data?.commands || [];
    assert.ok(commands.length >= 1);
    for (const command of commands) {
      for (const state of ['EN_PREPARACION','LISTA','ENTREGADA']) {
        const changed = await request(`/api/v1/restaurante/v2/kds/comandas/${command.id}`, { method: 'PATCH', token: adminToken, body: { state } });
        assert.equal(changed.status, 200, JSON.stringify(changed.data));
      }
    }

    const prepared = await request(`/api/v1/restaurante/mesas/${table.id}/preparar-cuenta`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
    const toCash = await request(`/api/v1/restaurante/mesas/${table.id}/enviar-caja`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(toCash.status, 200, JSON.stringify(toCash.data));

    let cash = await request('/api/v1/restaurante/v2/caja', { token: adminToken });
    assert.equal(cash.status, 200, JSON.stringify(cash.data));
    let ownShift = cash.data?.data?.shift?.own || null;
    const methods = cash.data?.data?.paymentMethods || [];
    let cashMethod = methods.find((row) => row.kind === 'EFECTIVO' && row.active && row.cajaBancoId);
    assert.ok(cashMethod, 'E5 necesita método EFECTIVO');
    if (!ownShift) {
      const openedShift = await request('/api/v1/restaurante/v2/caja/turno/abrir', {
        method: 'POST', token: adminToken, body: { cajaBancoId: cashMethod.cajaBancoId, saldoInicial: 100000 }
      });
      assert.equal(openedShift.status, 201, JSON.stringify(openedShift.data));
      ownShift = openedShift.data?.data?.shift;
    }
    assert.ok(ownShift?.id);
    if (ownShift.cajaBancoId !== cashMethod.cajaBancoId) {
      cashMethod = methods.find((row) => row.kind === 'EFECTIVO' && row.active && row.cajaBancoId === ownShift.cajaBancoId) || cashMethod;
    }

    const charge = await request(`/api/v1/restaurante/v2/caja/mesas/${table.id}/cobrar`, {
      method: 'POST', token: adminToken,
      body: { paymentMethodId: cashMethod.id, tipAmount: 0, reference: 'P13-E5', customerName: 'Cliente genérico' }
    });
    assert.equal(charge.status, 200, JSON.stringify(charge.data));
    assert.equal(charge.data?.data?.charged, true);
    assert.equal(charge.data?.data?.receiptDecisionRequired, true);
    const closedSessionId = charge.data?.data?.result?.session?.id;
    const saleId = charge.data?.data?.result?.sale?.id;
    const saleNumber = charge.data?.data?.result?.sale?.numero;
    assert.equal(closedSessionId, sessionId);
    assert.ok(saleId);

    const closed = await client.query(`SELECT state,"closedAt" FROM "RestaurantTableSession" WHERE id=$1 AND "tenantId"=$2`, [sessionId, tenantId]);
    assert.equal(closed.rows[0].state, 'CERRADA');
    assert.ok(closed.rows[0].closedAt);

    const history = await request('/api/v1/restaurante/p13-local/caja/ultimos-cobros?limit=15', { token: adminToken });
    assert.equal(history.status, 200, JSON.stringify(history.data));
    const recent = (history.data?.data?.rows || []).find((row) => row.sessionId === sessionId);
    assert.ok(recent, 'Últimos cobros debe contener la venta recién liquidada');
    assert.equal(recent.saleId, saleId);
    assert.equal(recent.saleNumber, saleNumber);

    const document = await request(`/api/v1/restaurante/p13-local/caja/documentos/${sessionId}`, { token: adminToken });
    assert.equal(document.status, 200, JSON.stringify(document.data));
    assert.equal(document.data?.data?.readOnly, true);
    assert.equal(document.data?.data?.sale?.id, saleId);
    assert.equal(document.data?.data?.sale?.balance, '0');
    assert.ok((document.data?.data?.sale?.items || []).length >= 1);
    assert.ok((document.data?.data?.sale?.items || []).some((row) => row.description && Number(row.quantity) > 0));

    const businessBefore = await canonicalTenantDigest(client, tenantId);
    const requestId = `cash-copy-${crypto.randomUUID()}`;
    const reprint = await request(`/api/v1/restaurante/p13-local/caja/documentos/${sessionId}/reimprimir`, {
      method: 'POST', token: adminToken, body: { requestId }
    });
    assert.equal(reprint.status, 201, JSON.stringify(reprint.data));
    assert.equal(reprint.data?.data?.queued, true);
    assert.equal(reprint.data?.data?.duplicate, false);
    assert.equal(reprint.data?.data?.copy, true);

    const queue = await client.query(`SELECT request_id,session_id,sale_id,status,attempts,bytes,payload_sha256,job FROM p13_local_receipt_reprint_queue WHERE request_id=$1`, [requestId]);
    assert.equal(queue.rowCount, 1);
    assert.equal(queue.rows[0].session_id, sessionId);
    assert.equal(queue.rows[0].sale_id, saleId);
    assert.equal(queue.rows[0].status, 'PENDING');
    assert.ok(Number(queue.rows[0].bytes) > 0);
    assert.equal(queue.rows[0].job?.payload?.copy, true);
    assert.ok(JSON.stringify(queue.rows[0].job).includes('COPIA / REIMPRESIÓN'));

    const businessAfter = await canonicalTenantDigest(client, tenantId);
    assert.deepEqual(businessAfter, businessBefore, 'Reimprimir no puede modificar ninguna tabla canónica del tenant');

    const retry = await request(`/api/v1/restaurante/p13-local/caja/documentos/${sessionId}/reimprimir`, {
      method: 'POST', token: adminToken, body: { requestId }
    });
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.equal(retry.data?.data?.duplicate, true);
    const queueCount = await client.query(`SELECT COUNT(*)::int AS count FROM p13_local_receipt_reprint_queue WHERE tenant_id=$1 AND request_id=$2`, [tenantId, requestId]);
    assert.equal(queueCount.rows[0].count, 1, 'Retry del mismo requestId no puede duplicar la copia');

    await stopRuntime(runtime); runtime = null;
    restarted = await startRuntime();
    const tokenAfterRestart = await loginAdmin();
    const documentAfterRestart = await request(`/api/v1/restaurante/p13-local/caja/documentos/${sessionId}`, { token: tokenAfterRestart });
    assert.equal(documentAfterRestart.status, 200, JSON.stringify(documentAfterRestart.data));
    assert.equal(documentAfterRestart.data?.data?.sale?.id, saleId);
    const queueAfterRestart = await client.query(`SELECT status FROM p13_local_receipt_reprint_queue WHERE request_id=$1`, [requestId]);
    assert.equal(queueAfterRestart.rowCount, 1);
    assert.equal(queueAfterRestart.rows[0].status, 'PENDING');

    const summary = await request('/api/v1/restaurante/v2/caja/turno/resumen', { token: tokenAfterRestart });
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    const expected = Number(summary.data?.data?.systemCashExpected || 0);
    assert.ok(Number.isFinite(expected));
    const closeShift = await request('/api/v1/restaurante/v2/caja/turno/cerrar', {
      method: 'POST', token: tokenAfterRestart, body: { saldoFinal: expected, tzOffsetMinutes: 300 }
    });
    assert.equal(closeShift.status, 200, JSON.stringify(closeShift.data));

    console.log(JSON.stringify({
      ok: true,
      phase: 'P13-E5-MINIMAL-LOCAL-CASH',
      localEntryRedirect: 'OK',
      superCoreUiCloudOnly: 'OK',
      canonicalCashSettlement: 'OK',
      recentSettledSales: 'OK',
      settledDocumentProducts: 'OK',
      reprintCopyQueue: 'OK',
      reprintIdempotency: 'OK',
      reprintCanonicalBusinessDigestUnchanged: 'OK',
      localRestartPreservesSettledDocument: 'OK',
      localCashShiftClose: 'OK',
      physicalPrinterInvoked: false,
      tenant: config.tenantSubdomain,
      table: table.code,
      sessionId,
      saleId,
      saleNumber,
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
  console.error(`P13_E5_CASH_HISTORY_REPRINT_SMOKE_FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
