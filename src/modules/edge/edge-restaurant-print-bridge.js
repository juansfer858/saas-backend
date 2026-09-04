'use strict';

const crypto = require('node:crypto');
const restaurantSync = require('./edge-restaurant-sync.service');
const printing = require('../platform/printing/printing.service');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.restaurant.print.bridge.v1');
const QUEUES = new Set(['COCINA', 'BARRA', 'POSTRES']);

function endpointKey(printer) {
  return `${String(printer?.host || '').trim().toLowerCase()}:${Number(printer?.port || 9100)}`;
}

function stableJobId(commandId, printer) {
  const target = `${printer?.id || ''}|${endpointKey(printer)}`;
  const digest = crypto.createHash('sha256').update(target).digest('hex').slice(0, 16);
  return `restaurant-command:${commandId}:printer:${digest}`;
}

function commandLines(command) {
  return (Array.isArray(command?.items) ? command.items : [])
    .filter((item) => Number(item?.quantity || 0) > 0 && String(item?.description || '').trim())
    .map((item) => ({
      quantity: Number(item.quantity),
      name: `${String(item.description).trim()}${item.notes ? ` · ${String(item.notes).trim()}` : ''}${item.seatNumber ? ` · P${Number(item.seatNumber)}` : ''}`
    }));
}

function buildCommandPrintJobs(commands, printers) {
  const byQueue = new Map();
  for (const printer of Array.isArray(printers) ? printers : []) {
    const queue = String(printer?.routeRole || printer?.role || '').trim().toUpperCase();
    if (!QUEUES.has(queue) || !String(printer?.host || '').trim()) continue;
    if (!byQueue.has(queue)) byQueue.set(queue, []);
    byQueue.get(queue).push(printer);
  }

  const jobs = [];
  for (const command of Array.isArray(commands) ? commands : []) {
    const queue = String(command?.station || '').trim().toUpperCase();
    if (!QUEUES.has(queue) || !command?.id) continue;
    const lines = commandLines(command);
    if (!lines.length) continue;
    const seenTargets = new Set();
    for (const printer of byQueue.get(queue) || []) {
      const targetKey = endpointKey(printer);
      if (seenTargets.has(targetKey)) continue;
      seenTargets.add(targetKey);
      jobs.push({
        id: stableJobId(command.id, printer),
        commandId: command.id,
        station: queue,
        stationId: printer.stationId || null,
        stationName: printer.stationName || null,
        printer: {
          id: printer.id || null,
          name: printer.name || 'Impresora',
          host: printer.host,
          port: Number(printer.port || 9100),
          format: printer.format || null
        },
        payload: {
          title: `COMANDA · ${command.table?.name || command.table?.code || 'Mesa'}`,
          lines,
          footer: `${queue} · ${String(command.state || 'PENDIENTE').replaceAll('_', ' ')}`,
          copies: 1,
          cut: true
        }
      });
    }
  }
  return jobs;
}

async function printRoutingForBootstrap(agent, bootstrap) {
  const queues = [...new Set((bootstrap?.commands || []).map((command) => String(command?.station || '').toUpperCase()).filter((queue) => QUEUES.has(queue)))];
  if (!queues.length) return { printJobs: [], printRouting: { version: 'V1', queues: [], printerCount: 0, jobCount: 0 } };
  try {
    const printers = await printing.printersForRoles(agent.tenantId, queues);
    const printJobs = buildCommandPrintJobs(bootstrap.commands, printers);
    return {
      printJobs,
      printRouting: {
        version: 'V1',
        queues,
        printerCount: new Set(printers.map(endpointKey)).size,
        jobCount: printJobs.length,
        localSpoolerRequired: true
      }
    };
  } catch (error) {
    return {
      printJobs: [],
      printRouting: { version: 'V1', queues, printerCount: 0, jobCount: 0, localSpoolerRequired: true, error: String(error?.code || error?.message || 'PRINT_ROUTING_ERROR').slice(0, 160) }
    };
  }
}

function install() {
  if (restaurantSync[INSTALL_FLAG]) return restaurantSync;
  const original = restaurantSync.buildRestaurantBootstrap.bind(restaurantSync);
  restaurantSync.buildRestaurantBootstrap = async function buildRestaurantBootstrapWithPrint(agent) {
    const bootstrap = await original(agent);
    const routing = await printRoutingForBootstrap(agent, bootstrap);
    return { ...bootstrap, ...routing };
  };
  Object.defineProperty(restaurantSync, INSTALL_FLAG, { value: true });
  return restaurantSync;
}

install();

module.exports = {
  INSTALL_FLAG,
  buildCommandPrintJobs,
  printRoutingForBootstrap,
  stableJobId,
  install
};
