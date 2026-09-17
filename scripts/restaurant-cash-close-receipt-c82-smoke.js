'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const receipt = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');
const {summaryRows,legacyReport,summaryPdfSpec,closeCross,ownCloseReport} = require('../src/modules/restaurant/restaurant-cash-close-summary.service');

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
    ingresosEfectivo: '453500',
    ingresosVoucher: '339500',
    egresosEfectivo: '50000',
    saldoEsperado: '503500',
    saldoFinal: '503500',
    descuadre: '0',
    expenseSummary:{ cash:'30000', transfer:'20000', total:'50000', count:3 },
    abiertoEn: '2026-09-11T13:00:00.000Z',
    cerradoEn: '2026-09-12T02:00:00.000Z'
  },
  restaurantClosedTablesTotal: '793000',
  systemCashExpected: '503500',
  restaurantCashRecorded: '453500',
  paymentBreakdown: {
    cashSales: '453500',
    transferSales: '185000',
    cardSales: '124500',
    bankOtherSales: '0',
    electronicSales: '309500',
    creditSales: '30000',
    exactMethodBreakdown: true
  },
  deliveryFees:{
    marker:'VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V125',count:3,billed:'13000',collected:'13000',
    cash:'3500',transfer:'5000',card:'4500',credit:'0',other:'0',bank:'9500',pending:'0'
  },
  production:{
    COCINA:{station:'COCINA',commands:10,deliveredItems:'20',value:'650000',readyNotDelivered:0},
    BARRA:{station:'BARRA',commands:5,deliveredItems:'10',value:'130000',readyNotDelivered:0},
    POSTRES:{station:'POSTRES',commands:0,deliveredItems:'0',value:'0',readyNotDelivered:0}
  },
  tables: [
    { table:'Mesa 1', saleNumber:'000000', total:'120000', paymentMethodKind:'EFECTIVO', paymentMethodLabel:'Efectivo' },
    { table:'Mesa 12 Terraza', saleNumber:'000001', total:'180000', paymentMethodKind:'TRANSFERENCIA', paymentMethodLabel:'Nequi / transferencia' },
    { table:'Mesa 7', saleNumber:'000002', total:'493000', paymentMethodKind:'TARJETA', paymentMethodLabel:'Tarjeta' }
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

const report=legacyReport(snapshot);
const own=ownCloseReport(report);
assert.equal(own.base,100000);
assert.equal(own.production.total,780000);
assert.equal(own.ownSales,780000,'los $13.000 de domicilio no son venta propia');
assert.equal(own.productionDifference,0);
assert.equal(own.ownPayments.cash,450000);
assert.equal(own.ownPayments.transfer,180000);
assert.equal(own.ownPayments.card,120000);
assert.equal(own.ownPayments.credit,30000);
assert.equal(own.covered,780000);
assert.equal(own.collectionDifference,0);
assert.equal(own.thirdParty.collected,13000);
assert.equal(own.thirdParty.cash,3500);
assert.equal(own.thirdParty.bank,9500);

const lines = receipt.cashCloseReceiptLines({ company, snapshot, paperFormat:'TERMICA_80' });
assert.ok(lines.length > 15, 'el cierre debe conservar base, ventas propias, recaudo, terceros y firmas');
assert.ok(lines.every((line) => String(line).length <= 48), 'ninguna línea puede desbordar la Epson de 80 mm');
assert.ok(lines.some((line) => line.includes('CIERRE DE TURNO / CAJA')));
assert.ok(lines.some((line) => line.trim() === 'VENTAS RESTAURANTE'));
assert.ok(lines.some((line) => line.trim() === 'RECAUDO VENTAS PROPIAS'));
assert.ok(lines.some((line) => line.trim() === 'FONDOS DE TERCEROS'));
assert.ok(lines.some((line) => line.includes('BASE')));
assert.ok(lines.some((line) => line.includes('TOTAL VENTAS PROPIAS')));
assert.ok(lines.some((line) => line.includes('Efectivo restaurante')));
assert.ok(lines.some((line) => line.includes('Transferencia / QR')));
assert.ok(lines.some((line) => line.includes('TOTAL CUBIERTO')));
assert.ok(lines.some((line) => line.includes('Cargos de domicilio')));
assert.ok(lines.some((line) => line.includes('TOTAL FONDOS')));
assert.ok(lines.some((line) => line.trim() === 'FIRMAS'));
assert.ok(!lines.some((line) => line.trim() === 'GASTOS'));
assert.ok(!lines.some((line) => line.trim() === 'CRUCE FINAL'));
assert.ok(!lines.some((line) => line.includes('ARQUEO DE CAJA')));
assert.ok(!lines.some((line) => line.includes('Efectivo esperado')));
assert.ok(!lines.some((line) => line.includes('Efectivo contado')));
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
  assert.ok(longLines.length < 60, `resumen acotado incluso en ${paperFormat}: ${longLines.length} líneas`);
  assert.ok(longLines.every(line=>line.length<=receipt.cashCloseColumns(paperFormat)));
  assert.doesNotMatch(longLines.join(' '),/PRODUCTO QUE NO|DETALLE DE VENTAS/);
}

const valueOf=(r,label)=>summaryRows(r).find(row=>row.label===label)?.value;
assert.equal(valueOf(report,'Apertura'),'2026-09-11 08:00');
assert.match(valueOf(report,'BASE'),/100\.000/);
assert.match(valueOf(report,'Cocina'),/650\.000/);
assert.match(valueOf(report,'Barra'),/130\.000/);
assert.match(valueOf(report,'TOTAL VENTAS PROPIAS'),/780\.000/);
assert.match(valueOf(report,'Efectivo restaurante'),/450\.000/);
assert.match(valueOf(report,'Transferencia \/ QR restaurante'),/180\.000/);
assert.match(valueOf(report,'Tarjeta'),/120\.000/);
assert.match(valueOf(report,'Crédito pendiente'),/30\.000/);
assert.match(valueOf(report,'TOTAL CUBIERTO'),/780\.000/);
assert.match(valueOf(report,'Cargos de domicilio cobrados \(3\)'),/13\.000/);
assert.match(valueOf(report,'Recibidos en efectivo'),/3\.500/);
assert.match(valueOf(report,'Recibidos por banco'),/9\.500/);
assert.equal(closeCross(report).sales,793000,'el cruce detallado conserva el movimiento bruto histórico');
assert.ok(!summaryRows(report).some(row=>['GASTOS','CRUCE FINAL','ARQUEO','CONTROL','CANALES','PAGOS'].includes(row.section)));
assert.ok(summaryRows(report).every(row=>['TURNO','VENTAS RESTAURANTE','RECAUDO VENTAS PROPIAS','FONDOS DE TERCEROS','FIRMAS'].includes(row.section)));
assert.ok(summaryRows(report).length<=22,'el resumen V125 debe seguir siendo compacto');

const busyReport={...report,channels:Object.fromEntries(['MESAS','MOSTRADOR','DOMICILIOS','PARA_LLEVAR'].map(k=>[k,{tickets:10,settledValue:100}])),
  exceptions:Array(10000).fill({type:'PRODUCCION_PENDIENTE'}),complete:{pending:Array(10000).fill({}),historicalReconstruction:true}};
const pdf = summaryPdfSpec(company,busyReport);
assert.deepEqual(pdf.headers,['Concepto','Resultado']);
assert.equal(pdf.columns.length,2);
assert.ok(pdf.rows.length<=22,'resumen PDF conserva base, ventas propias, recaudo, terceros y firmas');
assert.ok(summaryPdfSpec(company,{...busyReport,kind:'DAY',shiftCount:200}).rows.length<=22);

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
assert.deepEqual(receipt.buildCashCloseJob({ company, snapshot, printer }).id,job.id,'el mismo cierre no debe generar IDs distintos al reintentar/bootstrap');

const intent = {originType: receipt.CASH_SHIFT_ORIGIN_TYPE,timeline:[{ type:'OTHER_EVENT' },{ type:'CASH_SHIFT_CLOSE_RECEIPT_QUEUED', snapshot }]};
assert.equal(receipt.cashCloseSnapshotFromIntent(intent).shift.id, snapshot.shift.id);

const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
assert.match(routes, /USER_DECISION_REQUIRED/);
assert.match(routes, /shiftClosures\.ensureSnapshot/);
assert.match(routes, /restaurantShiftCloseHistoryC86Router/);
assert.doesNotMatch(routes, /queueShiftCloseIntent\(req\.tenantId, shiftId\)/, 'cerrar turno no debe gastar papel automáticamente');

const c86Runtime = fs.readFileSync('src/modules/restaurant/restaurant-shift-close-history-c86.runtime.js', 'utf8');
assert.match(c86Runtime, /posReceiptPrint\.queueShiftCloseIntent\(tenantId, shiftId, client, saved\)/, 'la impresión explícita debe reutilizar el outbox C82');
assert.match(c86Runtime, /PRINT_ACTION/);
assert.match(c86Runtime, /expenseTotalsForDayReport/,'el consolidado diario completo mantiene gastos aunque el resumen compacto no los imprima');

const printService = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-print.service.js', 'utf8');
assert.match(printService, /originType: \{ in: \[ORIGIN_TYPE, CASH_SHIFT_ORIGIN_TYPE\] \}/);
assert.match(printService, /restaurant-cash-close:/);
assert.match(printService, /EPSON_FULL_WIDTH_48_V1/);
assert.match(printService, /CASH_CLOSE_COLUMNS_80 = 48/);

const edgeBridge = fs.readFileSync('src/modules/edge/edge-restaurant-print-bridge.js', 'utf8');
assert.match(edgeBridge, /posReceipt\.buildRecentReceiptJobs/);
assert.doesNotMatch(edgeBridge, /restaurant-cash-close-receipt-c82/, 'no se debe crear un circuito paralelo en Edge');

console.log('RESTAURANT CASH CLOSE RECEIPT C82 V125 SMOKE OK', JSON.stringify({
  epson80Columns:48,
  baseVisible:true,
  ownSalesSeparated:true,
  thirdPartyFundsSeparated:true,
  noFinalArqueo:true,
  boundedSummary:true,
  stablePrintJob:true,
  optionalPrintDecision:true,
  sameExistingPosOutbox:true,
  edgeUntouched:true
}));
