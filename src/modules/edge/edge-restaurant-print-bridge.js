'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const restaurantSync = require('./edge-restaurant-sync.service');
const printing = require('../platform/printing/printing.service');
const printTemplate = require('../restaurant/restaurant-print-template.service');

const INSTALL_FLAG = Symbol.for('vantixgc.edge.restaurant.print.bridge.v1');
const QUEUES = new Set(['COCINA', 'BARRA', 'POSTRES']);

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

function normalizedCategory(value) {
  const category = String(value || '').trim().toUpperCase();
  return category || null;
}

function printItemName(item) {
  const name = String(item?.description || '').trim();
  const category = normalizedCategory(item?.category);
  return category ? `${name}\nCAT: ${category}` : name;
}

function commandLines(command) {
  return (Array.isArray(command?.items) ? command.items : [])
    .filter((item) => Number(item?.quantity || 0) > 0 && String(item?.description || '').trim())
    .map((item) => ({
      quantity: Number(item.quantity),
      name: printItemName(item),
      category: normalizedCategory(item.category),
      note: item.notes ? String(item.notes).trim() : null,
      seatNumber: item.seatNumber ? Number(item.seatNumber) : null,
      seatLabel: item.seatNumber ? `PERSONA ${Number(item.seatNumber)}` : null
    }));
}

async function commandsWithCategories(tenantId, commands) {
  const rows = Array.isArray(commands) ? commands : [];
  if (!rows.length) return rows;
  if (rows.every((command) => (command.items || []).every((item) => normalizedCategory(item.category)))) return rows;

  const orderIds = [...new Set(rows.map((command) => command?.orderId).filter(Boolean))];
  if (!orderIds.length) return rows;

  try {
    const orderItems = await prisma.restaurantOrderItem.findMany({
      where: { tenantId, orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        menuItemId: true,
        description: true,
        quantity: true,
        notes: true,
        seatNumber: true,
        station: true,
        creadoEn: true
      },
      orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }]
    });
    const menuItemIds = [...new Set(orderItems.map((item) => item.menuItemId).filter(Boolean))];
    const menuItems = menuItemIds.length
      ? await prisma.restaurantMenuItem.findMany({
          where: { tenantId, id: { in: menuItemIds } },
          select: { id: true, category: true }
        })
      : [];
    const categories = new Map(menuItems.map((item) => [item.id, normalizedCategory(item.category)]));
    const itemsByCommand = new Map();

    for (const item of orderItems) {
      const key = `${item.orderId}|${String(item.station || '').toUpperCase()}`;
      if (!itemsByCommand.has(key)) itemsByCommand.set(key, []);
      itemsByCommand.get(key).push({
        description: item.description,
        quantity: item.quantity,
        notes: item.notes,
        seatNumber: item.seatNumber,
        category: categories.get(item.menuItemId) || null
      });
    }

    return rows.map((command) => {
      const key = `${command.orderId}|${String(command.station || '').toUpperCase()}`;
      const items = itemsByCommand.get(key);
      return items?.length ? { ...command, items } : command;
    });
  } catch (_) {
    // La categoría mejora la identificación, pero jamás debe bloquear una impresión.
    return rows;
  }
}

function buildCommandPrintJobs(commands, printers, layout = null) {
  const byQueue = new Map();
  const normalizedLayout = printTemplate.normalizePrintTemplate(layout || printTemplate.DEFAULT_COMMAND_TEMPLATE);
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
      const transport = String(printer.transport || 'LAN').toUpperCase();
      jobs.push({
        id: stableJobId(command.id, printer),
        commandId: command.id,
        station: queue,
        stationId: printer.stationId || null,
        stationName: printer.stationName || null,
        printer: {
          id: printer.id || null,
          name: printer.name || 'Impresora',
          transport,
          host: printer.host,
          port: transport === 'LAN' ? Number(printer.port || 9100) : null,
          queueName: transport === 'WINDOWS' ? printer.host : null,
          format: printer.format || null
        },
        payload: {
          template: 'RESTAURANT_COMMAND_LARGE_V2',
          layout: normalizedLayout,
          title: `COMANDA · ${command.table?.name || command.table?.code || 'Mesa'}`,
          tableLabel: String(command.table?.name || command.table?.code || 'Mesa').trim(),
          stationLabel: queue,
          createdAt: command.createdAt || null,
          traceLabel: `COMANDA ${String(command.id).slice(0, 8).toUpperCase()}`,
          paperFormat: printer.format || 'TERMICA_80',
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
  if (!queues.length) return { printJobs: [], printRouting: { version: 'V3', queues: [], printerCount: 0, jobCount: 0, transports: [] } };
  try {
    const [printers, configuredLayout, categorizedCommands] = await Promise.all([
      printing.printersForRoles(agent.tenantId, queues),
      printTemplate.getPrintTemplate(agent.tenantId).catch(() => printTemplate.DEFAULT_COMMAND_TEMPLATE),
      commandsWithCategories(agent.tenantId, bootstrap.commands)
    ]);
    const layout = printTemplate.normalizePrintTemplate(configuredLayout);
    const printJobs = buildCommandPrintJobs(categorizedCommands, printers, layout);
    return {
      printJobs,
      printRouting: {
        version: 'V3',
        queues,
        printerCount: new Set(printers.map(endpointKey)).size,
        jobCount: printJobs.length,
        transports: [...new Set(printers.map((p) => String(p.transport || 'LAN').toUpperCase()))],
        templateVersion: layout.version,
        localSpoolerRequired: true
      }
    };
  } catch (error) {
    return {
      printJobs: [],
      printRouting: { version: 'V3', queues, printerCount: 0, jobCount: 0, transports: [], localSpoolerRequired: true, error: String(error?.code || error?.message || 'PRINT_ROUTING_ERROR').slice(0, 160) }
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
  endpointKey,
  commandLines,
  commandsWithCategories,
  buildCommandPrintJobs,
  printRoutingForBootstrap,
  stableJobId,
  install
};