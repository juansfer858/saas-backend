'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EdgeStore } = require('../edge/agent/store');
const {
  stableJobId,
  enqueueLocalCommandPrintJobs,
  enqueueSnapshotPrintJobs
} = require('../edge/agent/restaurant-print-bridge');
const offlineRouting = require('../src/modules/edge/edge-restaurant-offline-print-routing');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantix-edge-print-v55-'));
  const dbPath = path.join(dir, 'edge.sqlite');
  const store = new EdgeStore(dbPath, 'edge-offline-print-smoke-secret-2026');
  try {
    const operationId = crypto.randomUUID();
    const commandId = `local:${operationId}:COCINA`;
    const printer = {
      id: 'printer-kitchen-1',
      name: 'Cocina',
      transport: 'LAN',
      host: '192.168.50.20',
      port: 9100,
      queueName: null,
      format: 'TERMICA_80'
    };

    store.enqueueOperation({
      id: operationId,
      type: 'RESTAURANT_ORDER_CREATE',
      localTimestamp: new Date().toISOString(),
      payload: {
        sessionId: 'session-central-1',
        localSessionOperationId: null,
        items: [{ menuItemId: 'menu-1', quantity: 2, notes: 'Sin cebolla' }]
      }
    });

    const localSnapshot = {
      tables: [{ id: 'table-1', code: 'M7', name: 'Mesa 7', activeSession: { id: 'session-central-1' } }],
      commands: [{
        id: commandId,
        localOrderOperationId: operationId,
        station: 'COCINA',
        state: 'PENDIENTE',
        createdAt: new Date().toISOString(),
        items: [{ description: 'Hamburguesa', quantity: 2, notes: 'Sin cebolla' }]
      }],
      offlinePrintRouting: {
        version: 'EDGE_OFFLINE_PRINT_V1',
        internetRequired: false,
        retryLocal: true,
        layout: { version: 'smoke-layout' },
        routes: [{ station: 'COCINA', stationId: null, stationName: 'Cocina', printer }]
      }
    };

    const first = enqueueLocalCommandPrintJobs(store, localSnapshot);
    assert.equal(first.queued, 1, JSON.stringify(first));
    assert.equal(first.existing, 0);
    const expectedId = stableJobId(commandId, printer);
    let queue = store.printQueueSummary(20);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, expectedId);
    assert.equal(queue[0].state, 'PENDING');

    // A real printer failure must keep the same durable job for local retry.
    store.markPrintFailed(expectedId, 'PRINTER_TEMPORARILY_UNAVAILABLE', 500);
    queue = store.printQueueSummary(20);
    assert.equal(queue[0].state, 'FAILED');
    assert.equal(queue[0].attempts, 1);

    // When the local order reaches Core, the operation stores the central order id.
    // A later bootstrap may carry a central command print job with a different id.
    // It must reconcile to the already-created local job instead of printing twice.
    store.markSynced(operationId, 'central-order-1');
    const centralSnapshot = {
      commands: [{ id: 'central-command-1', orderId: 'central-order-1', station: 'COCINA', state: 'PENDIENTE' }],
      printJobs: [{
        id: 'restaurant-command:central-command-1:printer:different-central-id',
        commandId: 'central-command-1',
        station: 'COCINA',
        printer,
        payload: { title: 'COMANDA · Mesa 7', lines: [{ quantity: 2, name: 'Hamburguesa' }] }
      }]
    };
    const reconciled = enqueueSnapshotPrintJobs(store, centralSnapshot);
    assert.equal(reconciled.queued, 0, JSON.stringify(reconciled));
    assert.equal(reconciled.reconciled, 1, JSON.stringify(reconciled));
    queue = store.printQueueSummary(20);
    assert.equal(queue.length, 1, 'Reconnect must not create a second physical print job');
    assert.equal(queue[0].id, expectedId);

    assert.equal(offlineRouting.QUEUES.includes('COCINA'), true);
    assert.equal(offlineRouting.QUEUES.includes('BARRA'), true);
    assert.equal(offlineRouting.QUEUES.includes('POSTRES'), true);

    console.log('EDGE RESTAURANT OFFLINE PRINT V55 SMOKE OK', JSON.stringify({
      localCommandSpool:true,
      printerFailureRetriedLocally:true,
      reconnectDeduplicated:true,
      cloudRequiredForLocalPrint:false
    }));
  } finally {
    try { store.db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
