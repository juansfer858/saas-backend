'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const realtime = require('../src/modules/realtime/tenant-realtime.service');
const { topicsForPath, responseRefs } = require('../src/modules/realtime/tenant-realtime.routes');
const presence = require('../src/modules/restaurant/restaurant-qr-presence-realtime.public.routes');

const tableId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const openPath = `/api/v1/restaurante/mesas/${tableId}/abrir`;
const closePath = `/api/v1/restaurante/mesas/${tableId}/cerrar`;

const openTopics = topicsForPath(openPath);
const closeTopics = topicsForPath(closePath);
assert.ok(openTopics.includes('restaurant.table'), 'Abrir mesa debe publicar restaurant.table');
assert.ok(closeTopics.includes('restaurant.table'), 'Cerrar mesa debe publicar restaurant.table');

const refs = responseRefs({ table:{ id:tableId }, session:{ id:sessionId } }, openPath);
assert.equal(refs.tableId, tableId, 'la apertura debe identificar la mesa para el QR exacto');
assert.equal(refs.sessionId, sessionId, 'la apertura debe identificar la sesión abierta');

const event = realtime._makeEventForTest(
  tenantId,
  openTopics,
  { tableId, sessionId },
  { source:'qa-real-open-table', method:'POST', path:openPath }
);
assert.equal(
  presence.matchesTablePresence(event, { id:tableId }, null),
  true,
  'el stream QR debe aceptar el evento real de apertura aunque aún no tenga sessionId local'
);
assert.equal(
  presence.matchesTablePresence(
    realtime._makeEventForTest(tenantId, ['restaurant'], { tableId }, { source:'qa-wrong-topic' }),
    { id:tableId },
    null
  ),
  false,
  'un cambio genérico no debe despertar todas las mesas'
);

assert.equal(typeof realtime.ensureListenerReady, 'function');
assert.equal(presence.PRESENCE_RECONCILE_MS, 3000);

const presenceSource = fs.readFileSync('src/modules/restaurant/restaurant-qr-presence-realtime.public.routes.js', 'utf8');
const subscribeAt = presenceSource.indexOf('unsubscribe = realtime.subscribeTenant');
const listenerReadyAt = presenceSource.indexOf('await realtime.ensureListenerReady()');
const initialSnapshotAt = presenceSource.indexOf('let snapshot = await presenceSnapshot(table)');
assert.ok(subscribeAt >= 0, 'QR presence must subscribe before reading state');
assert.ok(listenerReadyAt > subscribeAt, 'PostgreSQL LISTEN readiness must be awaited after local subscribe');
assert.ok(initialSnapshotAt > listenerReadyAt, 'initial state must be read only after listener readiness');
assert.match(presenceSource, /PRESENCE_RECONCILE_MS = 3000/);
assert.match(presenceSource, /scheduleReconcile/);
assert.match(presenceSource, /reconcileFallback:true/);
assert.match(presenceSource, /listenerReadyBeforeInitialState:true/);
assert.doesNotMatch(presenceSource, /setInterval\(/, 'server safety guard must not create interval drift');

const qrClient = fs.readFileSync('src/web/restaurant-qr-realtime-ui.js', 'utf8');
assert.match(qrClient, /presenceEndpoint/);
assert.match(qrClient, /tablePresenceBeforeAuthorization:true/);
assert.match(qrClient, /DOMContentLoaded', startPresence/);
assert.ok(
  qrClient.lastIndexOf("DOMContentLoaded', startPresence") > qrClient.indexOf('function startPresence()'),
  'customer QR must start table presence independently of visit authorization'
);

const restaurantRoutes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');
assert.match(restaurantRoutes, /router\.post\('\/mesas\/:id\/abrir'/);
assert.match(restaurantRoutes, /service\.openTable\(req\.tenantId, req\.user, req\.params\.id/);

console.log('RESTAURANT QR TABLE PRESENCE REALTIME V25 SMOKE OK');
console.log(JSON.stringify({
  realOpenRouteClassifiedAsTable:true,
  tableAndSessionRefsPreserved:true,
  listenerReadyBeforeInitialState:true,
  immediateSseNotifyPath:true,
  canonicalReconcileGuardMs:presence.PRESENCE_RECONCILE_MS,
  qrListensBeforeVisitAuthorization:true,
  manualRefreshRequired:false
}, null, 2));
