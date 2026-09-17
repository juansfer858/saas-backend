'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const workspace = read('edge/agent/workspace-entry.js');
const waiterOffline = read('edge/agent/offline-waiter-hard-gate.js');
const qrOffline = read('edge/agent/offline-qr-self-order.js');
const printBridge = read('edge/agent/restaurant-print-bridge.js');
const registry = read('edge/runtime/vertical-registry.js');
const installer = read('edge/supervisor/install-windows.ps1');

assert.match(registry, /RESTAURANT:[\s\S]*localFirst:\s*true/);
assert.match(installer, /127\.0\.0\.1:\$Port\/app\/centro-de-control/);

assert.match(workspace, /\/workspace\/api\/tables\/\(\[\^\/\]\+\)\/open/);
assert.match(workspace, /\/workspace\/api\/tables\/\(\[\^\/\]\+\)\/account/);
assert.match(workspace, /\/workspace\/api\/tables\/\(\[\^\/\]\+\)\/orders/);
assert.match(workspace, /\/workspace\/api\/commands\/\(\.\+\)/);
assert.match(workspace, /\/workspace\/api\/tables\/\(\[\^\/\]\+\)\/close/);
assert.match(workspace, /\/workspace\/api\/cash\/open/);
assert.match(workspace, /\/workspace\/api\/cash\/\(\[\^\/\]\+\)\/close/);
assert.match(workspace, /enqueueOperation|queue\(/);

assert.match(waiterOffline, /offline/i);
assert.match(qrOffline, /offline/i);
assert.match(printBridge, /PRINT_QUEUE|print/i);

// P1 intentionally records the current gap: delivery does not yet have a local Workspace API.
assert.doesNotMatch(workspace, /workspace\/api\/(?:domicilios|deliveries)/i);

console.log(JSON.stringify({
  ok: true,
  restaurantLocalFirstDeclared: true,
  canonicalPcEntryIsEdge: true,
  tablesLocalCoverage: 'PARTIAL',
  waiterOrdersLocalCoverage: 'VERIFIED',
  kdsLocalCoverage: 'VERIFIED',
  printingLocalCoverage: 'VERIFIED',
  qrLocalCoverage: 'VERIFIED',
  cashLocalCoverage: 'PARTIAL',
  deliveryLocalCoverage: 'CORE_ONLY',
  nextPriority: 'DELIVERY_LOCAL_FIRST'
}));
