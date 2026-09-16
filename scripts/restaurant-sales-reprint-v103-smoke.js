'use strict';

const fs = require('fs');
const path = require('path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const service = read('src/modules/restaurant/restaurant-pos-receipt-reprint-v103.service.js');
const routes = read('src/modules/restaurant/restaurant-pos-receipt-reprint-v103.routes.js');
const signal = read('src/modules/restaurant/restaurant-pos-receipt-reprint-signal-v103.service.js');
const runtime = read('src/modules/restaurant/restaurant-sales-reprint-v103.public.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant.public.routes.js');
const edgeBridge = read('edge/agent/restaurant-print-bridge.js');

function requireMarkers(source, name, markers) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${name}: falta marcador ${marker}`);
  }
}

requireMarkers(service, 'service', [
  "REPRINT_ORIGIN_TYPE = 'RESTAURANT_POS_RECEIPT_REPRINT'",
  "REPRINT_EVENT = 'POS_RECEIPT_REPRINT_QUEUED'",
  ':reprint:${attemptId}:printer:',
  "estado: { not: 'ANULADO' }",
  "posReceipt.number(sale.saldo) > 0",
  "state: 'CERRADA'",
  'posReceipt.selectReceiptPrinters',
  'posReceipt.buildReceiptJob',
  "accion: 'REPRINT_POS_RECEIPT_QUEUED'",
  'printOnly: true',
  'financialMutation: false',
  'posReceipt.buildRecentReceiptJobs = async function buildRecentReceiptJobsWithReprints'
]);

if (/require\([^)]*(inventory|treasury|accounting|settlement-finalizer|restaurant-v2-cash\.service)/i.test(service)) {
  throw new Error('La reimpresión no debe importar servicios de mutación financiera/inventario.');
}

requireMarkers(routes, 'routes', [
  "requirePermission('RESTAURANTE.CERRAR')",
  "'/ventas/:saleId/reimpresion-tirilla'",
  "'/ventas/:saleId/reimprimir-tirilla'",
  'queueReceiptReprint',
  'requestPrintQueueSync'
]);

requireMarkers(signal, 'signal', [
  "'PRINT_QUEUE'",
  "operation: 'POS_RECEIPT_SYNC'",
  "source: 'SALES_REPRINT_V103'"
]);

requireMarkers(runtime, 'runtime', [
  'VANTIX_RESTAURANT_SALES_REPRINT_V103',
  'REIMPRIMIR TIRILLA',
  '/reimpresion-tirilla',
  '/reimprimir-tirilla',
  'REIMPRESIÓN ENVIADA ✓',
  'REIMPRESIÓN ENCOLADA ✓'
]);

requireMarkers(coreRoutes, 'core routes', [
  'restaurantPosReceiptReprintV103Router',
  "router.use('/restaurante', restaurantPosReceiptReprintV103Router)"
]);

requireMarkers(publicRoutes, 'public routes', [
  'restaurantSalesReprintV103PublicRouter',
  'installRestaurantSalesReprintV103'
]);

requireMarkers(edgeBridge, 'edge dedupe', [
  'function printJobExists',
  'if (printJobExists(store, job.id))',
  'store.enqueuePrintJob'
]);

if (service.includes('stableReceiptJobId(sale.id, printer)')) {
  throw new Error('La reimpresión no debe reutilizar el jobId estable de la impresión original.');
}

console.log('restaurant-sales-reprint-v103-smoke: OK');
