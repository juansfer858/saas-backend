'use strict';

const assert = require('node:assert/strict');
const { start } = require('../lab/restaurant-p14/runtime');
const { prisma } = require('../src/config/prisma');

const TENANT = 'demo-restaurante';
const EMAIL = 'admin@demo-restaurante.vantixgc.com';
const PASSWORD = String(process.env.P14_ADMIN_PASSWORD || '');
const BASE_URL = `http://127.0.0.1:${Number(process.env.P14_HTTP_PORT || 8791)}`;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      'x-tenant-subdomain': TENANT,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

function dataOf(payload) {
  return payload && Object.prototype.hasOwnProperty.call(payload, 'data')
    ? payload.data
    : payload;
}

function tablesOf(payload) {
  const data = dataOf(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tables)) return data.tables;
  return [];
}

function activeSessionOf(table) {
  return table?.activeSession || table?.session || table?.visit || null;
}

async function main() {
  assert.ok(PASSWORD.length >= 12, 'P14_ADMIN_PASSWORD debe estar configurada para el smoke.');

  const { server } = await start(process.env);
  let token = '';
  let tableId = '';

  try {
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    });
    assert.equal(login.response.status, 200, `Login P14 falló: ${JSON.stringify(login.payload)}`);
    token = String(dataOf(login.payload)?.token || '');
    assert.ok(token, 'Login P14 no devolvió token.');

    const authHeaders = { Authorization: `Bearer ${token}` };

    const initial = await request('/api/v1/restaurante/mesas', { headers: authHeaders });
    assert.equal(initial.response.status, 200, `Listado inicial de mesas falló: ${JSON.stringify(initial.payload)}`);
    const initialTables = tablesOf(initial.payload);
    assert.ok(initialTables.length > 0, 'demo-restaurante no tiene mesas para probar.');

    const freeTable = initialTables.find((table) => !activeSessionOf(table));
    assert.ok(freeTable?.id, 'No existe una mesa libre para probar P14-2A.');
    tableId = String(freeTable.id);

    const opened = await request(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/abrir`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ guestCount: 2, source: 'PANEL', sampleMode: false })
    });
    assert.equal(opened.response.status, 201, `Abrir mesa P14 falló: ${JSON.stringify(opened.payload)}`);
    assert.equal(opened.response.headers.get('x-vantixgc-p14-mutation-boundary'), 'TABLE_OPEN_P14_2A');

    const afterOpen = await request('/api/v1/restaurante/mesas', { headers: authHeaders });
    assert.equal(afterOpen.response.status, 200);
    const openedTable = tablesOf(afterOpen.payload).find((table) => String(table.id) === tableId);
    assert.ok(openedTable, 'La mesa abierta desapareció del listado.');
    assert.ok(activeSessionOf(openedTable), 'La mesa siguió libre después del POST de apertura.');

    const detail = await request(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/detalle-v67`, {
      headers: authHeaders
    });
    assert.equal(detail.response.status, 200, `Detalle de mesa abierta falló: ${JSON.stringify(detail.payload)}`);
    const detailData = dataOf(detail.payload) || {};
    assert.ok(
      detailData.session || detailData.activeSession || detailData.visit || detailData.table?.activeSession,
      'El detalle no presentó la visita activa de la mesa.'
    );

    const blockedCash = await request('/api/v1/restaurante/v2/caja/turno/abrir', {
      method: 'POST',
      headers: authHeaders,
      body: '{}'
    });
    assert.equal(blockedCash.response.status, 423, 'Caja se abrió antes de la frontera autorizada.');
    assert.equal(blockedCash.payload?.code, 'P14_OPERATIONAL_MUTATIONS_LOCKED');

    const blockedAccount = await request(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/pedir-cuenta`, {
      method: 'POST',
      headers: authHeaders,
      body: '{}'
    });
    assert.equal(blockedAccount.response.status, 423, 'Pedir cuenta se abrió antes de la frontera autorizada.');
    assert.equal(blockedAccount.payload?.code, 'P14_OPERATIONAL_MUTATIONS_LOCKED');

    const cancelled = await request(`/api/v1/restaurante/mesas/${encodeURIComponent(tableId)}/cancelar-apertura-v67`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'SMOKE_P14_2A' })
    });
    assert.ok(
      [200, 204].includes(cancelled.response.status),
      `Cancelar apertura vacía falló: HTTP ${cancelled.response.status} ${JSON.stringify(cancelled.payload)}`
    );
    assert.equal(cancelled.response.headers.get('x-vantixgc-p14-mutation-boundary'), 'TABLE_EMPTY_CANCEL_P14_2A');

    const afterCancel = await request('/api/v1/restaurante/mesas', { headers: authHeaders });
    assert.equal(afterCancel.response.status, 200);
    const releasedTable = tablesOf(afterCancel.payload).find((table) => String(table.id) === tableId);
    assert.ok(releasedTable, 'La mesa liberada desapareció del listado.');
    assert.equal(activeSessionOf(releasedTable), null, 'La mesa no volvió a LIBRE después de cancelar la apertura vacía.');

    console.log(`P14_TABLES_P2A_DB_OK table=${tableId}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
