'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const receipt = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');

const company = {
  nombreEmpresa: 'Restaurante San Juan',
  nit: '900123456-7',
  address: 'Calle 10 # 20-30',
  city: 'Yarumal',
  department: 'Antioquia',
  phone: '3001234567'
};

const snapshot = {
  shift: {
    id: '3af635af-c53f-4cf5-a8f5-123456789abc',
    cajaNombre: 'Caja Principal',
    cajero: 'María Cajera',
    saldoInicial: '100000',
    ingresosEfectivo: '450000',
    ingresosVoucher: '300000',
    egresosEfectivo: '50000',
    saldoEsperado: '500000',
    saldoFinal: '498000',
    descuadre: '-2000',
    expenseSummary:{ cash:'30000', transfer:'20000', total:'50000', count:3 },
    abiertoEn: '2026-09-11T13:00:00.000Z',
    cerradoEn: '2026-09-12T02:00:00.000Z'
  },
  restaurantClosedTablesTotal: '780000',
  systemCashExpected: '500000',
  restaurantCashRecorded: '450000',
  paymentBreakdown: {
    cashSales: '450000',
    transferSales: '180000',
    cardSales: '120000',
    bankOtherSales: '0',
    electronicSales: '300000',
    creditSales: '30000',
    exactMethodBreakdown: true
  },
  tables: [
    { table:'Mesa 1', saleNumber:'000000', total:'120000', paymentMethodKind:'EFECTIVO', paymentMethodLabel:'Efectivo' },
    { table:'Mesa 12 Terraza', saleNumber:'000001', total:'180000', paymentMethodKind:'TRANSFERENCIA', paymentMethodLabel:'Nequi / transferencia' },
    { table:'Mesa 7', saleNumber:'000002', total:'480000', paymentMethodKind:'TARJETA', paymentMethodLabel:'Tarjeta' }
  ]
};

const printer = {
  id:'printer-caja-1',
  name:'EPSON TM-T20III',
  role:'CAJA',
  active:true,
  transport:'WINDOWS',
  host:'EPSON TM-T20III Receipt',
  format:'TERMICA_80'
};

assert.equal(receipt.CASH_SHIFT_ORIGIN_TYPE, 'RESTAURANT_CASH_SHIFT_CLOSE_RECEIPT');
assert.equal(receipt.cashCloseColumns('TERMICA_80'), 48);
assert.equal(receipt.cashCloseColumns('80mm'), 48);
assert.equal(receipt.cashCloseColumns('TERMICA_58'), 32);

const lines = receipt.cashCloseReceiptLines({ company, snapshot, paperFormat:'TERMICA_80' });
assert.ok(lines.length > 15, 'el cierre debe conservar datos del turno, ventas, gastos, cruce y firmas');
assert.ok(lines.every((line) => String(line).length <= 48), 'ninguna línea puede desbordar la Epson de 80 mm');
assert.ok(lines.some((line) => line.includes('CIERRE DE TURNO / CAJA')));
assert.ok(lines.some((line) => line.trim() === 'VENTAS'));
assert.ok(lines.some((line) => line.includes('Efectivo')));
assert.ok(lines.some((line) => line.includes('Transferencias / QR')));
assert.ok(lines.some((line) => line.includes('Crédito')));
assert.ok(lines.some((line) => line.includes('Valor total')));
assert.ok(lines.some((line) => line.trim() === 'GASTOS'));
assert.ok(lines.some((line) => line.trim() === 'CRUCE FINAL'));
assert.ok(lines.some((line) => line.includes('Total gastos')));
assert.ok(lines.some((line) => line.includes('Ventas - gastos')));
assert.ok(lines.some((line) => line.trim() === 'FIRMAS'));
assert.ok(!lines.some((line) => line.includes('ARQUEO DE CAJA')));
assert.ok(!lines.some((line) => line.trim() === 'CONTROL'));
assert.ok(!lines.some((line) => line.includes('VENTAS POR CANAL')));
assert.ok(!lines.some((line) => line.includes('DESCUADRE')));
assert.ok(!lines.some((line) => line.includes('DETALLE DE VENTAS')));
assert.ok(!lines.some((line) => line.includes('000000')), 'las ventas individuales quedan en el informe completo');
assert.ok(lines.filter((line) => /^-+$/.test(line)).every((line) => line.length === 48), 'separadores deben consumir el ancho completo de 80 mm');

// The printed length is independent of historical order/audit list size, including old queued jobs.
const large = {...snapshot, tables:Array(10000).fill(snapshot.tables[0]), detailRows:Array(10000).fill(['PEDIDO','PRODUCTO QUE NO DEBE IMPRIMIRSE'])};
for (const paperFormat of ['TERMICA_80','TERMICA_58']) {
  const shortLines = receipt.cashCloseReceiptLines({company,snapshot,paperFormat});
  const longLines = receipt.cashCloseReceiptLines({company,snapshot:large,paperFormat});
  assert.equal(longLines.length, shortLines.length);
  assert.ok(longLines.length < 60, 'resumen acotado incluso en 58 mm');
  assert.ok(longLines.every(line=>line.length<=receipt.cashCloseColumns(paperFormat)));
  assert.doesNotMatch(longLines.join(' '),/PRODUCTO QUE NO|DETALLE DE VENTAS/);
}

const {summaryRows,legacyReport,summaryPdfSpec,closeCross} = require('../src/modules/restaurant/restaurant-cash-close-summary.service');
const valueOf=(report,label)=>summaryRows(report).find(row=>row.label===label)?.value;
const report=legacyReport(snapshot);
assert.equal(valueOf(report,'Apertura'),'2026-09-11 08:00');
assert.match(valueOf(report,'Efectivo'),/450\.000/);
assert.match(valueOf(report,'Transferencias / QR'),/180\.000/);
assert.match(valueOf(report,'Tarjetas'),/120\.000/);
assert.match(valueOf(report,'Crédito'),/30\.000/);
assert.match(valueOf(report,'Valor total'),/780\.000/);
assert.match(valueOf(report,'Efectivo / Banco'),/30\.000/);
assert.match(valueOf(report,'Efectivo / Banco'),/20\.000/);
assert.match(valueOf(report,'Total gastos \(3\)'),/50\.000/);
assert.match(valueOf(report,'Ventas - gastos'),/730\.000/);
assert.equal(closeCross(report).salesMinusExpenses,730000);
assert.equal(valueOf(report,'DESCUADRE'),undefined);
assert.equal(valueOf(report,'Estado efectivo'),undefined);
assert.equal(valueOf(report,'Alertas operativas'),undefined);
assert.ok(!summaryRows(report).some(row=>['ARQUEO','CONTROL','CANALES','PAGOS'].includes(row.section)));
assert.ok(summaryRows(report).every(row=>['TURNO','VENTAS','GASTOS','CRUCE FINAL','FIRMAS'].includes(row.section)));
assert.equal(summaryRows(report).length,16,'el resumen de cierre conserva el formato compacto V121');

const busyReport={...report,channels:Object.fromEntries(['MESAS','MOSTRADOR','DOMICILIOS','PARA_LLEVAR'].map(k=>[k,{tickets:10,settledValue:100}])),
  payments:{...report.payments,other:1},exceptions:Array(10000).fill({type:'PRODUCCION_PENDIENTE'}),
  complete:{pending:Array(10000).fill({}),historicalReconstruction:true,totals:{collected:100,priorInvoiceCollections:1,discount:1,vat:1,consumptionTax:1}}};
const pdf = summaryPdfSpec(company,busyReport);
assert.deepEqual(pdf.headers,['Concepto','Resultado']);
assert.equal(pdf.columns.length,2);
assert.ok(pdf.rows.length<=17,'resumen PDF conserva turno, ventas, gastos, cruce y firmas');
assert.ok(summaryPdfSpec(company,{...busyReport,kind:'DAY',shiftCount:200}).rows.length<=17);

const job = receipt.buildCashCloseJob({ company, snapshot, printer });
assert.match(job.id, /^restaurant-cash-close:/);
assert.equal(job.station, 'CAJA');
assert.equal(job.printer.transport, 'WINDOWS');
assert.equal(job.printer.queueName, printer.host);
assert.equal(job.payload.receiptType, 'RESTAURANT_CASH_SHIFT_CLOSE_V1');
assert.equal(job.payload.receiptLayout, 'EPSON_FULL_WIDTH_48_V1');
assert.equal(job.payload.columns, 48);
assert.equal(job.payload.cut, true);
assert.equal(job.payload.shiftId, snapshot.shift.id);
assert.deepEqual(
  receipt.buildCashCloseJob({ company, snapshot, printer }).id,
  job.id,
  'el mismo cierre no debe generar IDs distintos al reintentar/bootstrap'
);

const intent = {
  originType: receipt.CASH_SHIFT_ORIGIN_TYPE,
  timeline: [
    { type:'OTHER_EVENT' },
    { type:'CASH_SHIFT_CLOSE_RECEIPT_QUEUED', snapshot }
  ]
};
assert.equal(receipt.cashCloseSnapshotFromIntent(intent).shift.id, snapshot.shift.id);

const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
assert.match(routes, /USER_DECISION_REQUIRED/);
assert.match(routes, /shiftClosures\.ensureSnapshot/);
assert.match(routes, /restaurantShiftCloseHistoryC86Router/);
assert.doesNotMatch(routes, /queueShiftCloseIntent\(req\.tenantId, shiftId\)/, 'cerrar turno no debe gastar papel automáticamente');

const c86Runtime = fs.readFileSync('src/modules/restaurant/restaurant-shift-close-history-c86.runtime.js', 'utf8');
assert.match(c86Runtime, /posReceiptPrint\.queueShiftCloseIntent\(tenantId, shiftId, client, saved\)/, 'la impresión explícita debe reutilizar el outbox C82');
assert.match(c86Runtime, /PRINT_ACTION/);
assert.match(c86Runtime, /expenseTotalsForDayReport/,'el consolidado diario debe incluir gastos de todos los turnos');

const printService = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-print.service.js', 'utf8');
assert.match(printService, /originType: \{ in: \[ORIGIN_TYPE, CASH_SHIFT_ORIGIN_TYPE\] \}/);
assert.match(printService, /restaurant-cash-close:/);
assert.match(printService, /EPSON_FULL_WIDTH_48_V1/);
assert.match(printService, /CASH_CLOSE_COLUMNS_80 = 48/);

const edgeBridge = fs.readFileSync('src/modules/edge/edge-restaurant-print-bridge.js', 'utf8');
assert.match(edgeBridge, /posReceipt\.buildRecentReceiptJobs/);
assert.doesNotMatch(edgeBridge, /restaurant-cash-close-receipt-c82/, 'no se debe crear un circuito paralelo en Edge');

console.log('RESTAURANT CASH CLOSE RECEIPT C82 V121 SMOKE OK', JSON.stringify({
  epson80Columns:48,
  centeredHeader:true,
  compactExpenseSummary:true,
  finalExpenseCross:true,
  dayExpenseConsolidation:true,
  paymentBreakdown:true,
  noCashArqueoSection:true,
  noControlSection:true,
  boundedSummary:true,
  stablePrintJob:true,
  optionalPrintDecision:true,
  sameExistingPosOutbox:true,
  edgeUntouched:true
}));
