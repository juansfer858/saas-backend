'use strict';

const { EdgeStore } = require('./store');
const { listWindowsPrinters, printJob } = require('../print-spooler/escpos');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.print.bridge.v1');
const FETCH_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.immediate.print.fetch.v1');
const RELAY_POLL_FRAGMENT = '/edge/api/v1/relay/pull';
const WINDOWS_PRINTERS_OPERATION = 'WINDOWS_PRINTERS';
const WINDOWS_TEST_OPERATION = 'WINDOWS_TEST';

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

function relayOperation(request) {
  return String(request?.requestBody?.operation || '').trim().toUpperCase();
}

function relayCompleteUrl(pullUrl, id) {
  const source = new URL(pullUrl);
  return `${source.origin}/edge/api/v1/relay/${encodeURIComponent(id)}/complete`;
}

async function completeSpecialRelay(baseFetch, pullUrl, request, task) {
  try {
    const result = await task();
    await baseFetch(relayCompleteUrl(pullUrl, request.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vantix-edge-id': process.env.EDGE_AGENT_ID || '', 'x-vantix-edge-key': process.env.EDGE_AGENT_KEY || '' },
      body: JSON.stringify({ ok: true, response: result }),
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    await baseFetch(relayCompleteUrl(pullUrl, request.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vantix-edge-id': process.env.EDGE_AGENT_ID || '', 'x-vantix-edge-key': process.env.EDGE_AGENT_KEY || '' },
      body: JSON.stringify({ ok: false, errorCode: error?.code || 'WINDOWS_PRINT_RELAY_ERROR', errorMessage: error?.message || String(error) }),
      signal: AbortSignal.timeout(12000)
    }).catch(() => {});
  }
}

async function handleWindowsRelay(baseFetch, pullUrl, request) {
  const operation = relayOperation(request);
  if (operation === WINDOWS_PRINTERS_OPERATION) {
    await completeSpecialRelay(baseFetch, pullUrl, request, async () => ({
      platform: process.platform,
      printers: await listWindowsPrinters()
    }));
    return true;
  }
  if (operation === WINDOWS_TEST_OPERATION) {
    const printerName = String(request?.requestBody?.printerName || '').trim();
    await completeSpecialRelay(baseFetch, pullUrl, request, async () => ({
      platform: process.platform,
      print: await printJob({ transport: 'WINDOWS', host: printerName, name: printerName }, {
        title: 'VANTIXGC · PRUEBA',
        lines: ['Impresora USB / Windows conectada correctamente.', new Date().toLocaleString('es-CO')],
        footer: 'Esta impresión confirma la conexión con Cocina.',
        copies: 1,
        cut: true
      })
    }));
    return true;
  }
  return false;
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
      const requests = Array.isArray(body?.data) ? body.data : [];
      const remaining = [];
      for (const request of requests) {
        const action = String(request?.action || '').toUpperCase();
        if (action === 'PRINT_QUEUE' && await handleWindowsRelay(baseFetch, url, request)) continue;
        remaining.push(request);
      }
      const immediatePrint = remaining.some((request) => String(request?.action || '').toUpperCase() === 'PRINT_QUEUE');
      if (immediatePrint) {
        const port = Math.max(1, Number(process.env.EDGE_PORT || 8788));
        await baseFetch(`http://127.0.0.1:${port}/api/sync-now`, {
          method: 'POST',
          signal: AbortSignal.timeout(12000)
        });
      }
      if (remaining.length !== requests.length && typeof Response === 'function') {
        return new Response(JSON.stringify({ ...body, data: remaining }), { status: response.status, headers: response.headers });
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
  WINDOWS_PRINTERS_OPERATION,
  WINDOWS_TEST_OPERATION,
  printJobExists,
  enqueueSnapshotPrintJobs,
  relayOperation,
  relayCompleteUrl,
  handleWindowsRelay,
  installImmediateRelayTrigger,
  install
};
