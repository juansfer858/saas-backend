'use strict';

const crypto = require('node:crypto');
const { EdgeStore } = require('./store');
const { listWindowsPrinters, printJob } = require('../print-spooler/escpos');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.print.bridge.v1');
const FETCH_FLAG = Symbol.for('vantixgc.edge.agent.restaurant.immediate.print.fetch.v1');
const RELAY_POLL_FRAGMENT = '/edge/api/v1/relay/pull';
const WINDOWS_PRINTERS_OPERATION = 'WINDOWS_PRINTERS';
const WINDOWS_TEST_OPERATION = 'WINDOWS_TEST';
const RESTAURANT_QUEUES = new Set(['COCINA', 'BARRA', 'POSTRES']);

function endpointKey(printer) {
  const transport = String(printer?.transport || 'LAN').trim().toUpperCase();
  const host = String(printer?.host || '').trim().toLowerCase();
  return transport === 'WINDOWS' ? `WINDOWS:${host}` : `LAN:${host}:${Number(printer?.port || 9100)}`;
}

function stableJobId(commandId, printer) {
  const target = `${printer?.id || ''}|${endpointKey(printer)}`;
  const digest = crypto.createHash('sha256').update(target).digest('hex').slice(0, 16);
  return `restaurant-command:${commandId}:printer:${digest}`;
}

function printJobExists(store, id) {
  return Boolean(id && store?.db?.prepare('SELECT id FROM print_jobs WHERE id=?').get(String(id)));
}

function localOperationForCentralOrder(store, orderId) {
  if (!orderId || !store?.db) return null;
  return store.db.prepare("SELECT id FROM operations WHERE type='RESTAURANT_ORDER_CREATE' AND state='SYNCED' AND origin_document_id=? ORDER BY synced_at DESC LIMIT 1").get(String(orderId)) || null;
}

function localEquivalentJobId(store, payload, job) {
  if (!job?.commandId || !job?.printer) return null;
  const command = (Array.isArray(payload?.commands) ? payload.commands : []).find((row) => String(row?.id || '') === String(job.commandId));
  if (!command?.orderId) return null;
  const operation = localOperationForCentralOrder(store, command.orderId);
  if (!operation?.id) return null;
  const station = String(job.station || command.station || '').trim().toUpperCase();
  if (!RESTAURANT_QUEUES.has(station)) return null;
  return stableJobId(`local:${operation.id}:${station}`, job.printer);
}

function enqueueSnapshotPrintJobs(store, payload) {
  const jobs = Array.isArray(payload?.printJobs) ? payload.printJobs : [];
  let queued = 0;
  let existing = 0;
  let reconciled = 0;
  for (const job of jobs) {
    if (!job?.id || !job?.printer?.host || !job?.payload) continue;
    const localEquivalent = localEquivalentJobId(store, payload, job);
    if (localEquivalent && printJobExists(store, localEquivalent)) {
      reconciled += 1;
      continue;
    }
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
  if ((queued || reconciled) && typeof store.recordEvent === 'function') {
    store.recordEvent('RESTAURANT_COMMAND_PRINT_QUEUED', { queued, existing, reconciled, received: jobs.length });
  }
  const result = { queued, existing, received: jobs.length };
  if (reconciled > 0) result.reconciled = reconciled;
  return result;
}

function pendingRestaurantOperation(store, operationId) {
  return (typeof store?.listPending === 'function' ? store.listPending(500) : [])
    .find((row) => row.id === operationId && row.type === 'RESTAURANT_ORDER_CREATE') || null;
}

function tableLabelForLocalCommand(store, payload, command) {
  const operation = pendingRestaurantOperation(store, command?.localOrderOperationId);
  const sessionId = operation?.payload?.sessionId
    || (operation?.payload?.localSessionOperationId ? `local:${operation.payload.localSessionOperationId}` : null);
  const table = (Array.isArray(payload?.tables) ? payload.tables : []).find((row) => {
    const active = row?.activeSession;
    if (!active) return false;
    if (sessionId && String(active.id || '') === String(sessionId)) return true;
    return operation?.payload?.localSessionOperationId
      && String(active.localSessionOperationId || '') === String(operation.payload.localSessionOperationId);
  });
  return String(table?.name || table?.code || 'Mesa').trim() || 'Mesa';
}

function localCommandLines(command) {
  return (Array.isArray(command?.items) ? command.items : [])
    .filter((item) => Number(item?.quantity || 0) > 0 && String(item?.description || '').trim())
    .map((item) => ({
      quantity: Number(item.quantity),
      name: String(item.description).trim(),
      note: item.notes ? String(item.notes).trim() : null,
      seatNumber: item.seatNumber ? Number(item.seatNumber) : null,
      seatLabel: item.seatNumber ? `PERSONA ${Number(item.seatNumber)}` : null
    }));
}

function buildLocalCommandPrintJobs(store, payload) {
  const routing = payload?.offlinePrintRouting || {};
  const routes = Array.isArray(routing.routes) ? routing.routes : [];
  if (!routes.length) return [];
  const jobs = [];
  for (const command of Array.isArray(payload?.commands) ? payload.commands : []) {
    const commandId = String(command?.id || '');
    const station = String(command?.station || '').trim().toUpperCase();
    if (!commandId.startsWith('local:') || !RESTAURANT_QUEUES.has(station) || String(command?.state || '').toUpperCase() !== 'PENDIENTE') continue;
    const lines = localCommandLines(command);
    if (!lines.length) continue;
    const tableLabel = tableLabelForLocalCommand(store, payload, command);
    const seenTargets = new Set();
    for (const route of routes) {
      if (String(route?.station || '').trim().toUpperCase() !== station) continue;
      const printer = route?.printer || {};
      if (!String(printer.host || '').trim()) continue;
      const targetKey = endpointKey(printer);
      if (seenTargets.has(targetKey)) continue;
      seenTargets.add(targetKey);
      jobs.push({
        id: stableJobId(commandId, printer),
        station,
        printer,
        payload: {
          template: 'RESTAURANT_COMMAND_LARGE_V2',
          layout: routing.layout || null,
          title: `COMANDA · ${tableLabel}`,
          tableLabel,
          stationLabel: station,
          createdAt: command.createdAt || new Date().toISOString(),
          traceLabel: `COMANDA LOCAL ${String(command.localOrderOperationId || commandId).slice(0, 8).toUpperCase()}`,
          paperFormat: printer.format || 'TERMICA_80',
          lines,
          footer: `${station} · EDGE LOCAL`,
          copies: 1,
          cut: true
        }
      });
    }
  }
  return jobs;
}

function enqueueLocalCommandPrintJobs(store, payload) {
  const jobs = buildLocalCommandPrintJobs(store, payload);
  let queued = 0;
  let existing = 0;
  for (const job of jobs) {
    if (printJobExists(store, job.id)) {
      existing += 1;
      continue;
    }
    store.enqueuePrintJob({ id: job.id, role: job.station, printer: job.printer, payload: job.payload });
    queued += 1;
  }
  if (queued && typeof store.recordEvent === 'function') {
    store.recordEvent('RESTAURANT_OFFLINE_COMMAND_PRINT_QUEUED', { queued, existing, generated: jobs.length });
  }
  return { queued, existing, generated: jobs.length };
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
      if (kind === 'restaurant') {
        enqueueSnapshotPrintJobs(this, payload);
        enqueueLocalCommandPrintJobs(this, payload);
      }
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
  RESTAURANT_QUEUES,
  endpointKey,
  stableJobId,
  printJobExists,
  localOperationForCentralOrder,
  localEquivalentJobId,
  enqueueSnapshotPrintJobs,
  pendingRestaurantOperation,
  tableLabelForLocalCommand,
  localCommandLines,
  buildLocalCommandPrintJobs,
  enqueueLocalCommandPrintJobs,
  relayOperation,
  relayCompleteUrl,
  handleWindowsRelay,
  installImmediateRelayTrigger,
  install
};
