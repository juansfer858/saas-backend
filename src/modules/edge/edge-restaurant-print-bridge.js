'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const restaurantSync = require('./edge-restaurant-sync.service');
const printing = require('../platform/printing/printing.service');
const printTemplate = require('../restaurant/restaurant-print-template.service');
const posReceipt = require('../restaurant/restaurant-pos-receipt-print.service');

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

async function commandRouting(tenantId, bootstrap, queues) {
  if (!queues.length) return { jobs: [], printers: [], layout: null, error: null };
  try {
    const [printers, configuredLayout, categorizedCommands] = await Promise.all([
      printing.printersForRoles(tenantId, queues),
      printTemplate.getPrintTemplate(tenantId).catch(() => printTemplate.DEFAULT_COMMAND_TEMPLATE),
      commandsWithCategories(tenantId, bootstrap.commands)
    ]);
    const layout = printTemplate.normalizePrintTemplate(configuredLayout);
    return { jobs: buildCommandPrintJobs(categorizedCommands, printers, layout), printers, layout, error: null };
  } catch (error) {
    return { jobs: [], printers: [], layout: null, error: String(error?.code || error?.message || 'COMMAND_PRINT_ROUTING_ERROR').slice(0, 160) };
  }
}

async function printRoutingForBootstrap(agent, bootstrap) {
  const queues = [...new Set((bootstrap?.commands || []).map((command) => String(command?.station || '').toUpperCase()).filter((queue) => QUEUES.has(queue)))];
  const [commands, receipts] = await Promise.all([
    commandRouting(agent.tenantId, bootstrap, queues),
    posReceipt.buildRecentReceiptJobs(agent.tenantId).catch((error) => ({
      jobs: [], routing: 'ERROR', receiptCount: 0, printerCount: 0,
      error: String(error?.code || error?.message || 'POS_RECEIPT_ROUTING_ERROR').slice(0, 160)
    }))
  ]);
  const printJobs = [...commands.jobs, ...(receipts.jobs || [])];
  const transports = [...new Set([
    ...commands.printers.map((p) => String(p.transport || 'LAN').toUpperCase()),
    ...(receipts.jobs || []).map((job) => String(job?.printer?.transport || 'LAN').toUpperCase())
  ])];
  return {
    printJobs,
    printRouting: {
      version: 'V3',
      queues,
      printerCount: new Set(commands.printers.map(endpointKey)).size,
      jobCount: printJobs.length,
      transports,
      templateVersion: commands.layout?.version || null,
      localSpoolerRequired: true,
      commandJobCount: commands.jobs.length,
      posReceiptJobCount: (receipts.jobs || []).length,
      posReceiptCount: receipts.receiptCount || 0,
      posReceiptRouting: receipts.routing || 'NO_PHYSICAL_PRINTER',
      posReceiptPrinterCount: receipts.printerCount || 0,
      ...(commands.error ? { commandError: commands.error } : {}),
      ...(receipts.error ? { posReceiptError: receipts.error } : {})
    }
  };
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
  commandRouting,
  printRoutingForBootstrap,
  stableJobId,
  install
};
