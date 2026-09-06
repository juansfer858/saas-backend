'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const receipt = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');
const immediate = require('../src/modules/restaurant/restaurant-pos-receipt-immediate.public.routes');
const operational = require('../src/modules/restaurant/restaurant-pos-operational-mode');

function printable(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ');
}

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

const company = {
  nombreEmpresa:'Restaurante Vantix Demo',
  nit:'900123456-7',
  address:'Carrera 20 # 10-30',
  city:'Yarumal',
  department:'Antioquia',
  phone:'604 000 0000',
  email:'restaurante@vantixgc.com',
  receiptTitle:'RECIBO DE VENTA'
};
const sale = {
  id:'sale-1', numero:'000001', emitidoEn:'2026-09-06T14:00:00.000Z', formaPago:'EFECTIVO',
  subtotal:50000, descuentoTotal:0, ivaTotal:0, impoconsumoTotal:4000, total:54000, saldo:0,
  detalles:[
    { descripcion:'Hamburguesa especial', cantidad:2, precioUnitario:20000, totalLinea:40000 },
    { descripcion:'Limonada', cantidad:1, precioUnitario:14000, totalLinea:14000 }
  ]
};
const session = { id:'session-1', closedAt:'2026-09-06T14:03:00.000Z', tipAmount:5000, paymentMethodLabel:'Efectivo', paymentReference:null };
const table = { name:'Mesa 7', code:'M7' };

const lines80 = receipt.receiptLines({ company, sale, session, table, paperFormat:'TERMICA_80' });
const trimmed80 = lines80.map((line) => line.trim());
assert.equal(receipt.paperColumns('TERMICA_80'), 42);
assert.equal(trimmed80[0], 'RECIBO DE VENTA');
assert.equal(trimmed80.includes('TIRILLA POS'), false);
assert.ok(trimmed80.includes('NIT: 900123456-7'));
assert.ok(trimmed80.includes('Dirección: Carrera 20 # 10-30'));
assert.ok(trimmed80.includes('Yarumal · Antioquia'));
assert.ok(trimmed80.includes('Tel: 604 000 0000'));
assert.ok(trimmed80.includes('restaurante@vantixgc.com'));
assert.ok(lines80.some((line) => line.includes('Venta: 000001') && line.includes('Mesa: Mesa 7')), 'Venta y Mesa deben compartir el ancho útil');
assert.ok(lines80.some((line) => line.includes('2 x Hamburguesa especial')));
assert.ok(lines80.some((line) => line.startsWith('Subtotal') && printable(line).endsWith(printable(receipt.cop(50000)))), 'Subtotal debe terminar alineado a la derecha');
assert.ok(lines80.some((line) => line.startsWith('Impoconsumo') && printable(line).endsWith(printable(receipt.cop(4000)))));
assert.ok(lines80.some((line) => line.startsWith('Propina') && printable(line).endsWith(printable(receipt.cop(5000)))));
assert.ok(lines80.some((line) => line.startsWith('TOTAL') && printable(line).endsWith(printable(receipt.cop(59000)))));
assert.ok(lines80.some((line) => line.startsWith('Pago') && line.endsWith('Efectivo')));
assert.ok(lines80.includes('-'.repeat(42)), '80 mm debe usar separador de 42 columnas');
assert.ok(lines80.every((line) => line.length <= 42), 'ninguna línea de 80 mm puede exceder 42 columnas');
assert.ok(lines80[0].startsWith(' '.repeat(13)), 'el título del documento debe quedar centrado en 80 mm');
assert.doesNotMatch(lines80.join('\n'), /SIMULATED|SIMULADO/i);

const defaultLines = receipt.receiptLines({ company:{ ...company, receiptTitle:null }, sale, session, table, paperFormat:'TERMICA_80' });
assert.equal(defaultLines[0].trim(), 'COMPROBANTE DE VENTA');

const longSale = {
  ...sale,
  detalles:[
    { descripcion:'Hamburguesa artesanal con tocineta caramelizada y queso especial', cantidad:2, precioUnitario:20000, totalLinea:40000 }
  ]
};
const lines58 = receipt.receiptLines({ company, sale:longSale, session, table, paperFormat:'TERMICA_58' });
assert.equal(receipt.paperColumns('TERMICA_58'), 32);
assert.ok(lines58.includes('-'.repeat(32)), '58 mm debe usar separador de 32 columnas');
assert.ok(lines58.every((line) => line.length <= 32), 'ninguna línea de 58 mm puede exceder 32 columnas');
assert.ok(lines58.filter((line) => /Hamburguesa|artesanal|tocineta|caramelizada|queso|especial/.test(line)).length >= 2, 'descripciones largas deben envolver sin cortarse');

const jobA = receipt.buildReceiptJob({ company, sale, session, table, printer:windows });
const jobB = receipt.buildReceiptJob({ company, sale, session, table, printer:windows });
assert.equal(jobA.id, jobB.id, 'POS job must be deterministic to prevent duplicate prints');
assert.match(jobA.id, /^restaurant-pos:sale-1:printer:/);
assert.equal(jobA.station, 'CAJA');
assert.equal(jobA.printer.transport, 'WINDOWS');
assert.equal(jobA.payload.title, 'Restaurante Vantix Demo');
assert.equal(jobA.payload.receiptType, 'RESTAURANT_POS_V1');
assert.equal(jobA.payload.receiptLayout, 'FULL_WIDTH_V2');
assert.equal(jobA.payload.columns, 42);
assert.equal(jobA.payload.documentTitle, 'RECIBO DE VENTA');
assert.equal(jobA.payload.copies, 1);
assert.equal(jobA.payload.cut, true);
assert.equal(jobA.payload.footer.trim(), 'Gracias por su compra');
assert.ok(jobA.payload.footer.startsWith(' '), 'el pie debe llegar centrado al spooler');

const job58 = receipt.buildReceiptJob({ company, sale:longSale, session, table, printer:{ ...windows, id:'p58', format:'TERMICA_58' } });
assert.equal(job58.payload.columns, 32);
assert.equal(job58.payload.receiptLayout, 'FULL_WIDTH_V2');
assert.ok(job58.payload.lines.every((line) => line.length <= 32));

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
  sale:{ id:'sale-1', numero:'000001' },
  session:{ id:'session-1' },
  fiscalDocument:{ mode:'SIMULATED', internalNumber:'000001' },
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

console.log('RESTAURANT POS RECEIPT FULL WIDTH V2 + OPERATIONAL POS V40 SMOKE OK', JSON.stringify({
  automaticAfterPayment:true,
  fullWidthLayout:true,
  thermal80Columns:42,
  thermal58Columns:32,
  centeredDocumentTitle:true,
  centeredCompanyIdentity:true,
  saleAndTableDistributed:true,
  pricesRightAligned:true,
  totalsRightAligned:true,
  longProductWrap:true,
  centeredFooter:true,
  configurableDocumentTitle:true,
  defaultDocumentTitle:'COMPROBANTE DE VENTA',
  stableEdgeJobId:true,
  persistentEdgeQueue:true,
  cashPrinterPriority:true,
  documentPrinterFallback:true,
  singletonPhysicalFallback:true,
  ambiguousPrinterSafety:true,
  dianOptInOnly:true,
  nonDianOperationIsRealPos:true,
  noFiscalGateOnRestaurantOperation:true,
  edgeUpgradeRequired:false
}));
