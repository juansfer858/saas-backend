'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { buildCommandPrintJobs } = require('../src/modules/edge/edge-restaurant-print-bridge');
const { enqueueSnapshotPrintJobs } = require('../edge/agent/restaurant-print-bridge');
const { MARKER, patchKdsRuntime } = require('../src/modules/restaurant/restaurant-kds-reliability.public.routes');

const command = {
  id: 'command-cocina-1',
  station: 'COCINA',
  state: 'PENDIENTE',
  table: { id:'t1', code:'M1', name:'Mesa 1' },
  items: [
    { description:'Hamburguesa', quantity:2, notes:'Sin cebolla', seatNumber:1 },
    { description:'Papas', quantity:1, notes:null, seatNumber:null }
  ]
};

// Dos estaciones nominales pueden apuntar a la misma impresora física.
// Debe salir una sola comanda porque ambas resuelven la cola operativa COCINA.
const samePhysicalPrinterTwice = [
  { id:'p-hot', name:'Cocina caliente', host:'192.168.1.50', port:9100, role:'KDS_STATION_HOT', routeRole:'COCINA', stationId:'hot', stationName:'Cocina caliente' },
  { id:'p-cold', name:'Cocina fría', host:'192.168.1.50', port:9100, role:'KDS_STATION_COLD', routeRole:'COCINA', stationId:'cold', stationName:'Cocina fría' }
];
const jobs = buildCommandPrintJobs([command], samePhysicalPrinterTwice);
assert.equal(jobs.length, 1, 'same physical kitchen printer must receive one command only');
assert.equal(jobs[0].station, 'COCINA');
assert.equal(jobs[0].printer.host, '192.168.1.50');
assert.equal(jobs[0].payload.lines.length, 2);
assert.match(jobs[0].payload.lines[0].name, /Sin cebolla/);
assert.match(jobs[0].payload.title, /Mesa 1/);

const withBar = buildCommandPrintJobs([
  command,
  { ...command, id:'command-bar-1', station:'BARRA', items:[{ description:'Limonada', quantity:1 }] }
], [
  samePhysicalPrinterTwice[0],
  { id:'p-bar', name:'Barra', host:'192.168.1.51', port:9100, role:'BARRA', routeRole:'BARRA' }
]);
assert.equal(withBar.length, 2, 'distinct queues/printers must produce distinct jobs');

// La cola Edge debe ser idempotente aunque Core entregue el mismo bootstrap cada 15 s.
const existing = new Set();
const enqueued = [];
const events = [];
const fakeStore = {
  db: {
    prepare() {
      return { get(id) { return existing.has(String(id)) ? { id:String(id) } : undefined; } };
    }
  },
  enqueuePrintJob(job) { existing.add(String(job.id)); enqueued.push(job); return job.id; },
  recordEvent(type, details) { events.push({ type, details }); }
};
const firstQueue = enqueueSnapshotPrintJobs(fakeStore, { printJobs: jobs });
const secondQueue = enqueueSnapshotPrintJobs(fakeStore, { printJobs: jobs });
assert.deepEqual(firstQueue, { queued:1, existing:0, received:1 });
assert.deepEqual(secondQueue, { queued:0, existing:1, received:1 });
assert.equal(enqueued.length, 1, 'same command must never be printed twice from repeated bootstrap');
assert.equal(events.length, 1);

const baseUi = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
const patchedUi = patchKdsRuntime(baseUi);
assert.match(patchedUi, new RegExp(MARKER));
assert.match(patchedUi, /pendingSafety/);
assert.match(patchedUi, /kds-v2-lane\[hidden\]:has\(\.kds-command-card\)/);
assert.match(patchedUi, /data-kds-filter="PENDIENTE"/);
assert.doesNotThrow(() => new vm.Script(patchedUi), 'final KDS runtime must remain valid JavaScript');

const stationAdmin = fs.readFileSync('src/web/restaurant-kds-stations-admin.js', 'utf8');
assert.match(stationAdmin, /\['KDS', 'AMBOS'\]\.includes\(String\(row\.mode \|\| ''\)\.toUpperCase\(\)\)/, 'station manager still distinguishes screen and printer modes');
assert.match(patchedUi, /display:block!important/, 'active command lane must be rescued even when station configuration hides it');

const remoteAgent = fs.readFileSync('src/modules/edge/edge-remote-agent.service.js', 'utf8');
const lanDiscovery = fs.readFileSync('edge/agent/lan-discovery.js', 'utf8');
assert.match(remoteAgent, /edge-restaurant-print-bridge/);
assert.match(lanDiscovery, /restaurant-print-bridge/);

const edgeVersion = require('../edge/version.json');
assert.equal(edgeVersion.version, '2.1.2-kds-print.1');
assert.equal(edgeVersion.channel, 'PILOT');

console.log('RESTAURANT KDS PRINT RELIABILITY SMOKE OK', JSON.stringify({
  marker:MARKER,
  kitchenSinglePrinter:true,
  hotColdSameQueue:true,
  idempotentBootstrapPrint:true,
  pendingNeverHidden:true,
  pendingKpiActionable:true,
  edgeVersion:edgeVersion.version
}));
