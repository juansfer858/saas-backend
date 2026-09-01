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

assert.match(routes, /edge-restaurant-ingress\.service/);
const guardPosition = routes.indexOf('assertQrOrderIngressAvailable(req.params.token)');
const orderPosition = routes.indexOf('placeAuthorizedQrOrder(req.params.token');
assert.ok(guardPosition > 0, 'La ruta pública debe ejecutar el guard Edge');
assert.ok(orderPosition > guardPosition, 'El guard debe ejecutarse antes de crear el pedido');
assert.doesNotMatch(guardSource, /setInterval|MutationObserver/);
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
  assert.equal(status.source, 'EDGE_NOT_INSTALLED');

  status = await qrOrderIngressStatus('qr-1', {
    now,
    client: fakeClient({
      table,
      agents: [{ id: 'edge-1' }],
      installations: {
        'edge-1': { edgeAgentId: 'edge-1', lastHeartbeatAt: new Date(now - 30_000).toISOString(), healthStatus: 'OK' }
      }
    })
  });
  assert.equal(status.managedByEdge, true);
  assert.equal(status.available, true);
  assert.equal(status.source, 'SINGLE_EDGE_INSTALLATION');

  await assert.rejects(
    () => assertQrOrderIngressAvailable('qr-1', {
      now,
      client: fakeClient({
        table,
        agents: [{ id: 'edge-1' }],
        installations: {
          'edge-1': { edgeAgentId: 'edge-1', lastHeartbeatAt: new Date(now - 91_000).toISOString(), healthStatus: 'OK' }
        }
      })
    }),
    (error) => {
      assert.equal(error.statusCode || error.status, 503);
      assert.equal(error.code, 'RESTAURANT_QR_EDGE_OFFLINE');
      assert.match(error.message, /pedido no se envió/i);
      return true;
    }
  );

  await assert.rejects(
    () => assertQrOrderIngressAvailable('qr-1', {
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
    }),
    (error) => error.code === 'RESTAURANT_QR_EDGE_OFFLINE'
  );

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

  console.log('RESTAURANT QR EDGE OFFLINE GUARD SMOKE OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
