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
assert.ok(lines.length > 25, 'el cierre debe incluir encabezado, medios de pago, arqueo y detalle');
assert.ok(lines.every((line) => String(line).length <= 48), 'ninguna línea puede desbordar la Epson de 80 mm');
assert.ok(lines.some((line) => line.includes('CIERRE DE TURNO / CAJA')));
assert.ok(lines.some((line) => line.includes('VENTAS POR MEDIO DE PAGO')));
assert.ok(lines.some((line) => line.includes('ARQUEO DE CAJA')));
assert.ok(lines.some((line) => line.includes('DETALLE DE VENTAS')));
assert.ok(lines.some((line) => line.includes('Transferencias / QR')));
assert.ok(lines.some((line) => line.includes('DESCUADRE')));
assert.ok(lines.some((line) => line.includes('000000')), 'la primera venta POS 000000 debe imprimirse correctamente en el cierre');
assert.ok(lines.filter((line) => /^-+$/.test(line)).every((line) => line.length === 48), 'separadores deben consumir el ancho completo de 80 mm');

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
assert.match(routes, /printReceipt/);
assert.match(routes, /shiftCloseHistory\.ensureSnapshot/);
assert.match(routes, /shiftCloseHistory\.queuePrint/);
assert.match(routes, /closeReceipt/);
assert.match(routes, /SNAPSHOT_ERROR/);

const printService = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-print.service.js', 'utf8');
assert.match(printService, /originType: \{ in: \[ORIGIN_TYPE, CASH_SHIFT_ORIGIN_TYPE\] \}/);
assert.match(printService, /restaurant-cash-close:/);
assert.match(printService, /EPSON_FULL_WIDTH_48_V1/);
assert.match(printService, /CASH_CLOSE_COLUMNS_80 = 48/);
assert.match(printService, /queueShiftCloseSnapshotIntent/);

const edgeBridge = fs.readFileSync('src/modules/edge/edge-restaurant-print-bridge.js', 'utf8');
assert.match(edgeBridge, /posReceipt\.buildRecentReceiptJobs/);
assert.doesNotMatch(edgeBridge, /restaurant-cash-close-receipt-c82/, 'no se debe crear un circuito paralelo en Edge');

console.log('RESTAURANT CASH CLOSE RECEIPT C82 + C86 COMPAT SMOKE OK', JSON.stringify({
  epson80Columns:48,
  centeredHeader:true,
  paymentBreakdown:true,
  cashReconciliation:true,
  salesDetail:true,
  stableLegacyPrintJob:true,
  optionalC86Print:true,
  sameExistingPosOutbox:true,
  edgeUntouched:true
}));