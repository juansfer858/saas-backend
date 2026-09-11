'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../src/modules/restaurant/restaurant-shift-close-history-c86.service');
const print = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');

assert.equal(history.MARKER, 'VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86');
assert.equal(history.businessDate('2026-09-12T02:30:00.000Z', 300), '2026-09-11');
assert.equal(history.classifyTableChannel({ code: 'M01', name: 'Mesa 1' }), 'MESAS');
assert.equal(history.classifyTableChannel({ code: 'MOSTRADOR', name: 'Venta rápida' }), 'MOSTRADOR');
assert.equal(history.classifyTableChannel({ code: 'LLEVAR', name: 'Para llevar' }), 'PARA_LLEVAR');

const baseSnapshot = {
  marker: history.MARKER,
  version: history.VERSION,
  businessDate: '2026-09-11',
  status: 'CUADRADO',
  shift: {
    id: '11111111-1111-1111-1111-111111111111',
    cajaNombre: 'Caja principal',
    cajero: 'Cajero prueba',
    saldoInicial: '100000.00',
    ingresosEfectivo: '150000.00',
    ingresosVoucher: '50000.00',
    egresosEfectivo: '10000.00',
    saldoFinal: '240000.00',
    descuadre: '0.00',
    abiertoEn: '2026-09-11T13:00:00.000Z',
    cerradoEn: '2026-09-12T02:00:00.000Z'
  },
  channels: {
    MESAS: { key: 'MESAS', tickets: 2, deliveredItems: '4', kitchenItems: '3', productionValue: '120000.00', billedValue: '150000.00', tips: '10000.00', expectedSettlement: '160000.00', settledValue: '160000.00', difference: '0.00' },
    MOSTRADOR: { key: 'MOSTRADOR', tickets: 1, deliveredItems: '1', kitchenItems: '0', productionValue: '0.00', billedValue: '40000.00', tips: '0.00', expectedSettlement: '40000.00', settledValue: '40000.00', difference: '0.00' },
    DOMICILIOS: { key: 'DOMICILIOS', tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0.00', billedValue: '0.00', tips: '0.00', expectedSettlement: '0.00', settledValue: '0.00', difference: '0.00' },
    PARA_LLEVAR: { key: 'PARA_LLEVAR', tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0.00', billedValue: '0.00', tips: '0.00', expectedSettlement: '0.00', settledValue: '0.00', difference: '0.00' }
  },
  totals: { key: 'TOTAL', tickets: 3, deliveredItems: '5', kitchenItems: '3', productionValue: '120000.00', billedValue: '190000.00', tips: '10000.00', expectedSettlement: '200000.00', settledValue: '200000.00', difference: '0.00', accountsCharged: 3, kitchenDeliveredItems: '3' },
  production: {
    COCINA: { station: 'COCINA', commands: 2, deliveredItems: '3', value: '120000.00', readyNotDelivered: 0 },
    BARRA: { station: 'BARRA', commands: 1, deliveredItems: '2', value: '70000.00', readyNotDelivered: 0 },
    POSTRES: { station: 'POSTRES', commands: 0, deliveredItems: '0', value: '0.00', readyNotDelivered: 0 }
  },
  payments: { cash: '150000.00', transfer: '50000.00', card: '0.00', credit: '0.00', other: '0.00', total: '200000.00' },
  cash: { openingBalance: '100000.00', cashIncome: '150000.00', voucherIncome: '50000.00', cashOut: '10000.00', expectedCash: '240000.00', countedCash: '240000.00', difference: '0.00' },
  movements: [
    { id: 'mov-1', type: 'INGRESO', amount: '150000.00', reference: '000000', concept: 'Venta contado 000000', at: '2026-09-11T18:00:00.000Z' },
    { id: 'mov-2', type: 'EGRESO', amount: '10000.00', reference: 'GASTO', concept: 'Compra menor', at: '2026-09-11T20:00:00.000Z' }
  ],
  operations: [
    { channel: 'MESAS', reference: 'Mesa 1', saleNumber: '000000', openedAt: '2026-09-11T17:00:00.000Z', orderAt: '2026-09-11T17:05:00.000Z', collectedAt: '2026-09-11T18:00:00.000Z', collectedBy: 'Caja', billedValue: '100000.00', tips: '10000.00', collectedValue: '110000.00', paymentMethod: 'Efectivo', deliveredItems: '2', kitchenItems: '2', state: 'COBRADA' }
  ],
  exceptions: []
};

const aggregated = history.aggregateSnapshots([baseSnapshot, { ...baseSnapshot, shift: { ...baseSnapshot.shift, id: '22222222-2222-2222-2222-222222222222' } }], '2026-09-11');
assert.equal(aggregated.shiftCount, 2);
assert.equal(aggregated.totals.billedValue, '380000.00');
assert.equal(aggregated.totals.settledValue, '400000.00');
assert.equal(aggregated.production.COCINA.deliveredItems, '6');
assert.equal(aggregated.payments.cash, '300000.00');

const lines = print.cashCloseReceiptLines({ company: { nombreEmpresa: 'Restaurante Prueba' }, snapshot: baseSnapshot, paperFormat: 'TERMICA_80' });
assert.ok(lines.some((line) => line.includes('CIERRE OPERATIVO DE TURNO')));
assert.ok(lines.some((line) => line.includes('CONCILIACION GENERAL')));
assert.ok(lines.some((line) => line.includes('MOVIMIENTOS DE CAJA')));
assert.ok(lines.some((line) => line.includes('DETALLE DE OPERACIONES')));
assert.ok(lines.every((line) => String(line).length <= 48), 'La tirilla 80 mm no debe exceder 48 columnas');

const printer = { id: 'printer-1', transport: 'WINDOWS', host: 'EPSON-TM-T20', role: 'CAJA', format: 'TERMICA_80' };
const firstJob = print.buildCashCloseJob({ company: { nombreEmpresa: 'Restaurante Prueba' }, snapshot: baseSnapshot, printer, printRequestId: 'request-a' });
const secondJob = print.buildCashCloseJob({ company: { nombreEmpresa: 'Restaurante Prueba' }, snapshot: baseSnapshot, printer, printRequestId: 'request-b' });
assert.notEqual(firstJob.id, secondJob.id, 'Cada reimpresión explícita debe tener un job id nuevo');
assert.equal(firstJob.payload.receiptType, 'RESTAURANT_CASH_SHIFT_CLOSE_C86');
assert.equal(firstJob.payload.columns, 48);

const routesSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/restaurant/restaurant-shift-close-history-c86.routes.js'), 'utf8');
assert.match(routesSource, /\/v2\/caja\/cierres/);
assert.match(routesSource, /\/imprimir/);
assert.match(routesSource, /\/exportar/);

const cashRouteSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/restaurant/restaurant-v2-cash.routes.js'), 'utf8');
assert.match(cashRouteSource, /printReceipt/);
assert.match(cashRouteSource, /ensureSnapshot/);
assert.match(cashRouteSource, /origin: 'CLOSE_FLOW'/);

const uiSource = fs.readFileSync(path.resolve(__dirname, '../src/web/restaurant-shift-close-history-c86.js'), 'utf8');
assert.match(uiSource, /VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86/);
assert.match(uiSource, /Imprimir tirilla/);
assert.match(uiSource, /exportar/);

console.log('Restaurant Shift Close History C86 smoke: OK');