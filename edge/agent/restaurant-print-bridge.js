'use strict';

const { EdgeStore } = require('./store');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.print.bridge.v1');
const FETCH_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.immediate.print.fetch.v1');
const RELAY_POLL_FRAGMENT = '/edge/api/v1/relay/pull';

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

function installImmediateRelayTrigger(target = globalThis) {
  const currentFetch = target?.fetch;
  if (typeof currentFetch !== 'function' || currentFetch[FETCH_FLAG]) return target;
  const baseFetch = currentFetch.bind(target);
  const wrapped = async function vantixImmediatePrintFetch(input, options) {
    const response = await baseFetch(input, options);
    const url = String(typeof input === 'string' || input instanceof URL ? input : input?.url || '');
    if (!url.includes(RELAY_POLL_FRAGMENT)) return response;
    try {
      const body = await response.clone().json();
      const immediatePrint = (body?.data || []).some((request) => String(request?.action || '').toUpperCase() === 'PRINT_QUEUE');
      if (immediatePrint) {
        const port = Math.max(1, Number(process.env.EDGE_PORT || 8788));
        await baseFetch(`http://127.0.0.1:${port}/api/sync-now`, {
          method: 'POST',
          signal: AbortSignal.timeout(12000)
        });
      }
    } catch {}
    return response;
  };
  Object.defineProperty(wrapped, FETCH_FLAG, { value: true });
  target.fetch = wrapped;
  return target;
}

function install() {
  if (!EdgeStore.prototype[INSTALL_FLAG]) {
    const originalPutSnapshot = EdgeStore.prototype.putSnapshot;
    EdgeStore.prototype.putSnapshot = function putSnapshotWithRestaurantPrint(kind, version, payload) {
      const result = originalPutSnapshot.call(this, kind, version, payload);
      if (kind === 'restaurant') enqueueSnapshotPrintJobs(this, payload);
      return result;
    };
    Object.defineProperty(EdgeStore.prototype, INSTALL_FLAG, { value: true });
  }
  installImmediateRelayTrigger();
  return EdgeStore;
}

install();

module.exports = {
  INSTALL_FLAG,
  FETCH_FLAG,
  RELAY_POLL_FRAGMENT,
  printJobExists,
  enqueueSnapshotPrintJobs,
  installImmediateRelayTrigger,
  install
};
