'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EDGE_HEARTBEAT_ONLINE_MS,
  heartbeatOnline,
  qrOrderIngressStatus,
  assertQrOrderIngressAvailable
} = require('../src/modules/edge/edge-restaurant-ingress.service');

const root = path.resolve(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-visit.public.routes.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'src/modules/edge/edge-restaurant-ingress.service.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(root, 'src/modules/edge/edge-restaurant-sync.service.js'), 'utf8');

assert.match(routes, /edge-restaurant-ingress\.service/);
const guardPosition = routes.indexOf('assertQrOrderIngressAvailable(req.params.token)');
const orderPosition = routes.indexOf('placeAuthorizedQrOrder(req.params.token');
assert.ok(guardPosition > 0, 'La ruta pública debe resolver la política Edge antes del pedido');
assert.ok(orderPosition > guardPosition, 'La política Edge debe resolverse antes de crear el pedido');
assert.doesNotMatch(guardSource, /setInterval|MutationObserver/);
assert.doesNotMatch(guardSource, /RESTAURANT_QR_EDGE_OFFLINE/, 'Un heartbeat Edge viejo no debe bloquear el ingreso cloud');
assert.match(guardSource, /CLOUD_FALLBACK/);
assert.match(syncSource, /restaurantCommand\.findMany/);
assert.match(syncSource, /PENDIENTE/);
assert.match(syncSource, /EN_PREPARACION/);
assert.match(syncSource, /LISTA/);
assert.equal(EDGE_HEARTBEAT_ONLINE_MS, 90_000);

const now = Date.parse('2026-08-31T23:00:00.000Z');
assert.equal(heartbeatOnline(new Date(now - 30_000).toISOString(), now), true);
assert.equal(heartbeatOnline(new Date(now - 91_000).toISOString(), now), false);
assert.equal(heartbeatOnline(null, now), false);

function fakeClient({ table = null, channel = null, agents = [], installations = {} } = {}) {
  return {
    restaurantTable: {
      findUnique: async () => table
    },
    edgeRemoteChannel: {
      findFirst: async () => channel
    },
    edgeAgent: {
      findMany: async () => agents.slice(0, 2)
    },
    edgeInstallation: {
      findUnique: async ({ where }) => installations[where.edgeAgentId] || null
    }
  };
}

const table = { id: 'table-1', tenantId: 'tenant-1', active: true };

(async () => {
  let status = await qrOrderIngressStatus('qr-1', {
    now,
    client: fakeClient({ table })
  });
  assert.equal(status.managedByEdge, false);
  assert.equal(status.available, true);
  assert.equal(status.source, 'NO_ACTIVE_EDGE');

  status = await qrOrderIngressStatus('qr-1', {
    now,
    client: fakeClient({ table, agents: [{ id: 'edge-1' }] })
  });
  assert.equal(status.managedByEdge, false);
  assert.equal(status.available, true);
  assert.equal(status.source, 'EDGE_NOT_INSTALLED');

  status = await qrOrderIngressStatus('qr-1', {
    now,
    client: fakeClient({
      table,
      agents: [{ id: 'edge-1' }],
      installations: {
        'edge-1': {
          edgeAgentId: 'edge-1',
          lastHeartbeatAt: new Date(now - 30_000).toISOString(),
          healthStatus: 'OK',
          lanHost: '192.168.1.10',
          lanPort: 8788
        }
      }
    })
  });
  assert.equal(status.managedByEdge, true);
  assert.equal(status.available, true);
  assert.equal(status.edgeOnline, true);
  assert.equal(status.cloudFallback, false);
  assert.equal(status.transportMode, 'EDGE_ONLINE');
  assert.equal(status.source, 'SINGLE_EDGE_INSTALLATION');

  status = await assertQrOrderIngressAvailable('qr-1', {
    now,
    client: fakeClient({
      table,
      agents: [{ id: 'edge-1' }],
      installations: {
        'edge-1': {
          edgeAgentId: 'edge-1',
          lastHeartbeatAt: new Date(now - 91_000).toISOString(),
          healthStatus: 'OK',
          lanHost: '192.168.1.10',
          lanPort: 8788
        }
      }
    })
  });
  assert.equal(status.managedByEdge, true);
  assert.equal(status.available, true);
  assert.equal(status.edgeOnline, false);
  assert.equal(status.cloudFallback, true);
  assert.equal(status.transportMode, 'CLOUD_FALLBACK');
  assert.equal(status.localFallbackUrl, 'http://192.168.1.10:8788/r/qr-1?mode=lan');

  status = await assertQrOrderIngressAvailable('qr-1', {
    now,
    client: fakeClient({
      table,
      channel: { edgeAgentId: 'edge-table' },
      agents: [{ id: 'edge-other-1' }, { id: 'edge-other-2' }],
      installations: {
        'edge-table': { edgeAgentId: 'edge-table', lastHeartbeatAt: new Date(now - 120_000).toISOString(), healthStatus: 'OK' },
        'edge-other-1': { edgeAgentId: 'edge-other-1', lastHeartbeatAt: new Date(now - 10_000).toISOString(), healthStatus: 'OK' }
      }
    })
  });
  assert.equal(status.managedByEdge, true);
  assert.equal(status.edgeOnline, false);
  assert.equal(status.cloudFallback, true);
  assert.equal(status.transportMode, 'CLOUD_FALLBACK');
  assert.equal(status.source, 'TABLE_EDGE_CHANNEL');

  status = await qrOrderIngressStatus('qr-1', {
    now,
    client: fakeClient({
      table,
      agents: [{ id: 'edge-1' }, { id: 'edge-2' }],
      installations: {
        'edge-1': { edgeAgentId: 'edge-1', lastHeartbeatAt: new Date(now - 120_000).toISOString() },
        'edge-2': { edgeAgentId: 'edge-2', lastHeartbeatAt: new Date(now - 10_000).toISOString() }
      }
    })
  });
  assert.equal(status.managedByEdge, false);
  assert.equal(status.available, true);
  assert.equal(status.source, 'EDGE_TOPOLOGY_AMBIGUOUS');

  console.log('RESTAURANT QR EDGE HYBRID CLOUD FALLBACK SMOKE OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
