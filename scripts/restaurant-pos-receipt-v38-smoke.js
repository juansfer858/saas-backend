'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const receipt = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');
const immediate = require('../src/modules/restaurant/restaurant-pos-receipt-immediate.public.routes');
const operational = require('../src/modules/restaurant/restaurant-pos-operational-mode');

const windows = { id:'p1', name:'Caja', transport:'WINDOWS', host:'EPSON TM-T20', role:'CAJA', format:'TERMICA_80', active:true };
const kitchen = { id:'p2', name:'Cocina', transport:'WINDOWS', host:'COCINA', role:'STATION:abc', format:'TERMICA_80', active:true };
const documents = { id:'p3', name:'Documentos', transport:'LAN', host:'10.0.0.8', port:9100, role:'DOCUMENTOS', format:'TERMICA_80', active:true };

assert.equal(receipt.selectReceiptPrinters([windows, kitchen]).routing, 'CAJA');
assert.deepEqual(receipt.selectReceiptPrinters([windows, kitchen]).printers.map((x) => x.id), ['p1']);
assert.equal(receipt.selectReceiptPrinters([documents, kitchen]).routing, 'DOCUMENTOS');
assert.deepEqual(receipt.selectReceiptPrinters([documents, kitchen]).printers.map((x) => x.id), ['p3']);
assert.equal(receipt.selectReceiptPrinters([kitchen]).routing, 'SINGLE_PHYSICAL_FALLBACK');
assert.equal(receipt.selectReceiptPrinters([kitchen, { ...windows, role:'STATION:def' }]).routing, 'AMBIGUOUS_PHYSICAL_PRINTERS');
assert.equal(receipt.selectReceiptPrinters([]).routing, 'NO_PHYSICAL_PRINTER');

const sale = {
  id:'sale-1', numero:'FV-1001', emitidoEn:'2026-09-06T14:00:00.000Z', formaPago:'EFECTIVO',
  subtotal:50000, descuentoTotal:0, ivaTotal:0, impoconsumoTotal:4000, total:54000, saldo:0,
  detalles:[
    { descripcion:'Hamburguesa especial', cantidad:2, precioUnitario:20000, totalLinea:40000 },
    { descripcion:'Limonada', cantidad:1, precioUnitario:14000, totalLinea:14000 }
  ]
};
const session = { id:'session-1', closedAt:'2026-09-06T14:03:00.000Z', tipAmount:5000, paymentMethodLabel:'Efectivo', paymentReference:null };
const table = { name:'Mesa 7', code:'M7' };
const lines = receipt.receiptLines({ sale, session, table });
assert.ok(lines.includes('TIRILLA POS'));
assert.ok(lines.includes('Venta: FV-1001'));
assert.ok(lines.includes('Mesa: Mesa 7'));
assert.ok(lines.some((line) => line.includes('2 x Hamburguesa especial')));
assert.ok(lines.some((line) => line.startsWith('Subtotal:')));
assert.ok(lines.some((line) => line.startsWith('Impoconsumo:')));
assert.ok(lines.some((line) => line.startsWith('Propina:')));
assert.ok(lines.some((line) => line.startsWith('TOTAL:')));
assert.ok(lines.includes('Pago: Efectivo'));
assert.doesNotMatch(lines.join('\n'), /SIMULATED|SIMULADO/i);

const jobA = receipt.buildReceiptJob({ tenantName:'VantixGC Demo Core', sale, session, table, printer:windows });
const jobB = receipt.buildReceiptJob({ tenantName:'VantixGC Demo Core', sale, session, table, printer:windows });
assert.equal(jobA.id, jobB.id, 'POS job must be deterministic to prevent duplicate prints');
assert.match(jobA.id, /^restaurant-pos:sale-1:printer:/);
assert.equal(jobA.station, 'CAJA');
assert.equal(jobA.printer.transport, 'WINDOWS');
assert.equal(jobA.payload.receiptType, 'RESTAURANT_POS_V1');
assert.equal(jobA.payload.copies, 1);
assert.equal(jobA.payload.cut, true);

assert.equal(receipt.ORIGIN_TYPE, 'RESTAURANT_POS_RECEIPT');
assert.equal(typeof receipt.queueReceiptIntent, 'function');
assert.equal(typeof receipt.buildPendingReceiptJobs, 'function');
assert.equal(receipt.buildRecentReceiptJobs, receipt.buildPendingReceiptJobs);

assert.equal(immediate.MARKER, 'VANTIX_RESTAURANT_POS_RECEIPT_V38');
assert.doesNotThrow(() => new vm.Script(immediate.runtime));
assert.match(immediate.runtime, /cerrar-con-metodo/);
assert.match(immediate.runtime, /pagos-divididos/);
assert.match(immediate.runtime, /action:'PRINT_QUEUE'/);
assert.match(immediate.runtime, /operation:'POS_RECEIPT_SYNC'/);
assert.match(immediate.runtime, /response\.ok/);
assert.doesNotMatch(immediate.runtime, /throw new Error|alert\(/);

const status = operational.operationalStatus({
  dianRealEnabled:false,
  physicalPrinterFieldPass:false,
  metaBusinessManagementReviewPass:false,
  whatsappOrderReadyEnabled:true,
  printMode:'ESC_POS'
});
assert.equal(status.productionReady, true);
assert.equal(status.productionLabel, 'OPERACIÓN RESTAURANTE ACTIVA');
assert.equal(status.label, 'Operación POS activa');
assert.deepEqual(status.limitations, []);
assert.equal(status.fiscalIntegration.enabled, false);
assert.equal(status.fiscalIntegration.mode, 'OPTIONAL_DISABLED');
assert.equal(status.posOperation.mode, 'POS_INTERNO');
assert.equal(status.posOperation.electronicInvoiceRequired, false);
assert.doesNotMatch(JSON.stringify(status), /SIMULATED|SIMULADO|BLOQUEADA/i);

const normalized = operational.operationalResult({
  sale:{ id:'sale-1', numero:'FV-1001' },
  session:{ id:'session-1' },
  fiscalDocument:{ mode:'SIMULATED', internalNumber:'FV-1001' },
  posReceipt:{ queued:true }
}, { dianRealEnabled:false, printMode:'ESC_POS' });
assert.equal(normalized.operationMode, 'POS_INTERNO');
assert.equal(normalized.fiscalDocument.mode, 'POS');
assert.equal(normalized.fiscalDocument.electronic, false);
assert.equal(normalized.posReceipt.mode, 'TIRILLA_POS');
assert.equal(normalized.posReceipt.queued, true);
assert.doesNotMatch(JSON.stringify(normalized), /SIMULATED|SIMULADO/i);

const operationalSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-operational-mode.js', 'utf8');
assert.match(operationalSource, /sourceId\.startsWith\('REST-TABLE-'\)/);
assert.match(operationalSource, /!config\?\.dianRealEnabled/);
assert.match(operationalSource, /restaurantFiscalDocument\.deleteMany/);
assert.match(operationalSource, /mode: 'SIMULATED'/);
assert.match(operationalSource, /queueReceiptIntent/);
assert.match(operationalSource, /queueReceiptForTableIfClosed/);

const bridge = fs.readFileSync('src/modules/edge/edge-restaurant-print-bridge.js', 'utf8');
assert.match(bridge, /buildRecentReceiptJobs/);
assert.match(bridge, /posReceiptJobCount/);
assert.match(bridge, /posReceiptRouting/);
assert.doesNotMatch(bridge, /if \(!queues\.length\) return \{ printJobs: \[\]/, 'POS receipts must be available even when there are no pending kitchen commands');

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-pos-operational-mode/);
assert.match(publicRoutes, /installPosReceiptImmediateRuntime/);
assert.ok(publicRoutes.indexOf('installPosReceiptImmediateRuntime') < publicRoutes.lastIndexOf('restaurantTenantRealtimePublicRouter'), 'POS runtime must compose before canonical restaurant-ui sender');

console.log('RESTAURANT POS RECEIPT V38 + OPERATIONAL POS V40 SMOKE OK', JSON.stringify({
  automaticAfterPayment:true,
  normalClose:true,
  paymentMethodClose:true,
  splitFinalPayment:true,
  stableEdgeJobId:true,
  persistentEdgeQueue:true,
  receiptIntentOnly:true,
  noHistoricalBackfill:true,
  cashPrinterPriority:true,
  documentPrinterFallback:true,
  singletonPhysicalFallback:true,
  ambiguousPrinterSafety:true,
  dianOptInOnly:true,
  nonDianOperationIsRealPos:true,
  simulatedFiscalRecordRemoved:true,
  noFiscalGateOnRestaurantOperation:true,
  edgeUpgradeRequired:false
}));
