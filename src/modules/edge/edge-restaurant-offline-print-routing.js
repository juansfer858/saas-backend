'use strict';

const restaurantSync = require('./edge-restaurant-sync.service');
const printing = require('../platform/printing/printing.service');
const printTemplate = require('../restaurant/restaurant-print-template.service');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.restaurant.offline.print.routing.v1');
const QUEUES = ['COCINA', 'BARRA', 'POSTRES'];

function normalizePrinter(printer) {
  const transport = String(printer?.transport || 'LAN').trim().toUpperCase();
  return {
    id: printer?.id || null,
    name: printer?.name || 'Impresora',
    transport,
    host: printer?.host || null,
    port: transport === 'LAN' ? Number(printer?.port || 9100) : null,
    queueName: transport === 'WINDOWS' ? printer?.host || null : null,
    format: printer?.format || null
  };
}

async function buildOfflinePrintRouting(tenantId) {
  try {
    const [printers, configuredLayout] = await Promise.all([
      printing.printersForRoles(tenantId, QUEUES),
      printTemplate.getPrintTemplate(tenantId).catch(() => printTemplate.DEFAULT_COMMAND_TEMPLATE)
    ]);
    const layout = printTemplate.normalizePrintTemplate(configuredLayout || printTemplate.DEFAULT_COMMAND_TEMPLATE);
    return {
      version: 'EDGE_OFFLINE_PRINT_V1',
      internetRequired: false,
      retryLocal: true,
      queues: QUEUES,
      layout,
      routes: printers
        .filter((printer) => QUEUES.includes(String(printer?.routeRole || '').toUpperCase()) && String(printer?.host || '').trim())
        .map((printer) => ({
          station: String(printer.routeRole).toUpperCase(),
          stationId: printer.stationId || null,
          stationName: printer.stationName || null,
          printer: normalizePrinter(printer)
        }))
    };
  } catch (error) {
    return {
      version: 'EDGE_OFFLINE_PRINT_V1',
      internetRequired: false,
      retryLocal: true,
      queues: QUEUES,
      layout: printTemplate.normalizePrintTemplate(printTemplate.DEFAULT_COMMAND_TEMPLATE),
      routes: [],
      error: String(error?.code || error?.message || 'EDGE_OFFLINE_PRINT_ROUTING_ERROR').slice(0, 160)
    };
  }
}

function install() {
  if (restaurantSync[INSTALL_FLAG]) return restaurantSync;
  const original = restaurantSync.buildRestaurantBootstrap.bind(restaurantSync);
  restaurantSync.buildRestaurantBootstrap = async function buildRestaurantBootstrapWithOfflinePrintRouting(agent) {
    const bootstrap = await original(agent);
    const offlinePrintRouting = await buildOfflinePrintRouting(agent.tenantId);
    return { ...bootstrap, offlinePrintRouting };
  };
  Object.defineProperty(restaurantSync, INSTALL_FLAG, { value: true });
  return restaurantSync;
}

install();

module.exports = {
  INSTALL_FLAG,
  QUEUES,
  normalizePrinter,
  buildOfflinePrintRouting,
  install
};
