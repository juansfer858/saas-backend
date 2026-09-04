'use strict';

const { EdgeStore } = require('./store');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.print.bridge.v1');

function printJobExists(store, id) {
  return Boolean(id && store?.db?.prepare('SELECT id FROM print_jobs WHERE id=?').get(String(id)));
}

function enqueueSnapshotPrintJobs(store, payload) {
  const jobs = Array.isArray(payload?.printJobs) ? payload.printJobs : [];
  let queued = 0;
  let existing = 0;
  for (const job of jobs) {
    if (!job?.id || !job?.printer?.host || !job?.payload) continue;
    if (printJobExists(store, job.id)) {
      existing += 1;
      continue;
    }
    store.enqueuePrintJob({
      id: String(job.id),
      role: String(job.station || 'COCINA').toUpperCase(),
      printer: job.printer,
      payload: job.payload
    });
    queued += 1;
  }
  if (queued && typeof store.recordEvent === 'function') {
    store.recordEvent('RESTAURANT_COMMAND_PRINT_QUEUED', { queued, existing, received: jobs.length });
  }
  return { queued, existing, received: jobs.length };
}

function install() {
  if (EdgeStore.prototype[INSTALL_FLAG]) return EdgeStore;
  const originalPutSnapshot = EdgeStore.prototype.putSnapshot;
  EdgeStore.prototype.putSnapshot = function putSnapshotWithRestaurantPrint(kind, version, payload) {
    const result = originalPutSnapshot.call(this, kind, version, payload);
    if (kind === 'restaurant') enqueueSnapshotPrintJobs(this, payload);
    return result;
  };
  Object.defineProperty(EdgeStore.prototype, INSTALL_FLAG, { value: true });
  return EdgeStore;
}

install();

module.exports = { INSTALL_FLAG, printJobExists, enqueueSnapshotPrintJobs, install };
