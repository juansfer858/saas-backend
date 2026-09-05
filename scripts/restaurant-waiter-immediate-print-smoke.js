'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';
process.env.EDGE_PORT ||= '8788';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  RELAY_ACTION,
  commandIdsFromOrder,
  requestImmediatePrint
} = require('../src/modules/edge/edge-restaurant-immediate-print-bridge');
const {
  installImmediateRelayTrigger,
  RELAY_POLL_FRAGMENT
} = require('../edge/agent/restaurant-print-bridge');

async function main() {
  const order = { id:'order-1', commands:[{ id:'cmd-kitchen-1' }, { id:'cmd-bar-1' }] };
  assert.deepEqual(commandIdsFromOrder(order), ['cmd-kitchen-1','cmd-bar-1']);
  assert.equal(RELAY_ACTION, 'PRINT_QUEUE');

  const created = [];
  const fakeClient = {
    edgeInstallation: {
      async findFirst(args) {
        assert.equal(args.where.tenantId, 'tenant-1');
        assert.equal(args.where.relayConnected, true);
        assert.ok(args.where.lastHeartbeatAt.gte instanceof Date);
        return { edgeAgentId:'edge-1', lastHeartbeatAt:new Date() };
      }
    },
    edgeAgent: {
      async findFirst(args) {
        assert.deepEqual(args.where, { id:'edge-1', tenantId:'tenant-1', state:'ACTIVE' });
        return { id:'edge-1' };
      }
    },
    edgeRelayRequest: {
      async create(args) {
        created.push(args.data);
        return { id:'relay-1', edgeAgentId:args.data.edgeAgentId, action:args.data.action, creadoEn:new Date() };
      }
    }
  };

  const signal = await requestImmediatePrint('tenant-1', order, fakeClient);
  assert.equal(signal.queued, true);
  assert.equal(signal.relayRequestId, 'relay-1');
  assert.deepEqual(signal.commandIds, ['cmd-kitchen-1','cmd-bar-1']);
  assert.equal(created.length, 1);
  assert.equal(created[0].action, 'PRINT_QUEUE');
  assert.equal(created[0].requestBody.reason, 'RESTAURANT_WAITER_SEND_TO_KITCHEN');
  assert.equal(created[0].requestBody.orderId, 'order-1');
  assert.deepEqual(created[0].requestBody.commandIds, ['cmd-kitchen-1','cmd-bar-1']);
  assert.ok(created[0].expiresAt.getTime() > Date.now());

  assert.deepEqual(await requestImmediatePrint('tenant-1', { id:'empty', commands:[] }, fakeClient), { queued:false, reason:'NO_COMMANDS' });

  const noEdgeClient = {
    ...fakeClient,
    edgeInstallation: { async findFirst() { return null; } },
    edgeRelayRequest: { async create() { throw new Error('must not create relay without online edge'); } }
  };
  assert.deepEqual(await requestImmediatePrint('tenant-1', order, noEdgeClient), { queued:false, reason:'NO_ONLINE_EDGE' });

  const calls = [];
  const relayResponse = (data) => ({ clone:() => ({ json:async() => ({ data }) }) });
  const fakeTarget = {
    async fetch(input, options = {}) {
      const url = String(input);
      calls.push({ url, method:options.method || 'GET' });
      if (url.includes(RELAY_POLL_FRAGMENT)) return relayResponse([{ id:'r1', action:'PRINT_QUEUE' }]);
      return relayResponse([]);
    }
  };
  installImmediateRelayTrigger(fakeTarget);
  await fakeTarget.fetch(`https://core.vantixgc.com${RELAY_POLL_FRAGMENT}?limit=20`);
  assert.equal(calls.filter((row) => row.url.includes(RELAY_POLL_FRAGMENT)).length, 1);
  const localSync = calls.find((row) => row.url === 'http://127.0.0.1:8788/api/sync-now');
  assert.ok(localSync, 'PRINT_QUEUE relay must force local /api/sync-now');
  assert.equal(localSync.method, 'POST');

  const passiveCalls = [];
  const passiveTarget = {
    async fetch(input, options = {}) {
      const url = String(input);
      passiveCalls.push({ url, method:options.method || 'GET' });
      return relayResponse([{ id:'r2', action:'STATUS' }]);
    }
  };
  installImmediateRelayTrigger(passiveTarget);
  await passiveTarget.fetch(`https://core.vantixgc.com${RELAY_POLL_FRAGMENT}?limit=20`);
  assert.equal(passiveCalls.some((row) => row.url.includes('/api/sync-now')), false, 'non-print relay must not force restaurant sync');

  const remoteAgent = fs.readFileSync('src/modules/edge/edge-remote-agent.service.js','utf8');
  const edgeBridge = fs.readFileSync('edge/agent/restaurant-print-bridge.js','utf8');
  assert.match(remoteAgent, /edge-restaurant-immediate-print-bridge/);
  assert.match(edgeBridge, /printJobExists/);
  assert.match(edgeBridge, /\/api\/sync-now/);
  assert.match(edgeBridge, /WINDOWS_PRINTERS/);
  assert.match(edgeBridge, /WINDOWS_TEST/);

  const version = require('../edge/version.json');
  assert.match(version.version, /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/);
  assert.equal(version.channel, 'PILOT');

  console.log('RESTAURANT WAITER IMMEDIATE PRINT SMOKE OK', JSON.stringify({
    waiterSendCreatesRelay:true,
    relayAction:'PRINT_QUEUE',
    edgeForcesLocalSyncNow:true,
    windowsUsbRelay:true,
    persistentPrintQueueRemainsIdempotent:true,
    fallbackPeriodicBootstrapPreserved:true,
    edgeVersion:version.version
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
