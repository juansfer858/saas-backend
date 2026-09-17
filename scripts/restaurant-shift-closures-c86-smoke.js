'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../src/modules/restaurant/restaurant-shift-close-history-c86.runtime');
const deliveryFeesService = require('../src/modules/restaurant/restaurant-close-delivery-fees-v123.service');
const closeSummary = require('../src/modules/restaurant/restaurant-cash-close-summary.service');

assert.equal(service.MARKER, 'VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86');
assert.equal(service.businessDate('2026-09-12T02:30:00.000Z', 300), '2026-09-11');
assert.equal(service.classifyTableChannel({ name: 'Mostrador' }), 'MOSTRADOR');
assert.equal(service.classifyTableChannel({ code: 'PARA_LLEVAR' }), 'PARA_LLEVAR');
assert.equal(service.classifyTableChannel({ name: 'Mesa 8' }), 'MESAS');
assert.equal(deliveryFeesService.MARKER, 'VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V127');

const snapshot = {
  marker: service.MARKER,
  businessDate: '2026-09-11',
  status: 'CUADRADO',
  shift: { id: 'shift-1', cajaNombre: 'Caja principal', cajero: 'Caja', saldoInicial:'100000', expenseSummary:{cash:'12000',transfer:'8000',total:'20000',count:2}, abiertoEn: '2026-09-11T13:00:00.000Z', cerradoEn: '2026-09-12T02:30:00.000Z' },
  channels: {
    MESAS: { tickets: 2, deliveredItems: '4', kitchenItems: '3', productionValue: '60000', billedValue: '60000', tips: '0', expectedSettlement: '60000', settledValue: '60000' },
    MOSTRADOR: { tickets: 1, deliveredItems: '1', kitchenItems: '1', productionValue: '15000', billedValue: '15000', tips: '0', expectedSettlement: '15000', settledValue: '15000' },
    DOMICILIOS: { tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0', billedValue: '0', tips: '0', expectedSettlement: '0', settledValue: '0' },
    PARA_LLEVAR: { tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0', billedValue: '0', tips: '0', expectedSettlement: '0', settledValue: '0' }
  },
  totals: { tickets: 3, deliveredItems: '5', kitchenItems: '4', productionValue: '75000', billedValue: '75000', tips: '0', expectedSettlement: '75000', settledValue: '75000', difference: '0', accountsCharged: 3, kitchenDeliveredItems: '4' },
  production: {
    COCINA: { station: 'COCINA', commands: 2, deliveredItems: '4', value: '65000', readyNotDelivered: 0 },
    BARRA: { station: 'BARRA', commands: 1, deliveredItems: '1', value: '10000', readyNotDelivered: 0 },
    POSTRES: { station: 'POSTRES', commands: 0, deliveredItems: '0', value: '0', readyNotDelivered: 0 }
  },
  payments: { cash: '50000', transfer: '25000', card: '0', credit: '0', other: '0', total: '75000' },
  cash: { openingBalance: '100000', cashIncome: '50000', voucherIncome: '25000', cashOut: '0', expectedCash: '150000', countedCash: '150000', difference: '0' },
  operations: [{ channel: 'MESAS', state: 'COBRADA' }, { channel: 'MESAS', state: 'COBRADA' }, { channel: 'MOSTRADOR', state: 'COBRADA' }],
  movements: [],
  exceptions: []
};
const day = service.aggregateSnapshots([snapshot], '2026-09-11');
assert.equal(day.shiftCount, 1);
assert.equal(day.channels.MESAS.tickets, 2);
assert.equal(day.channels.MOSTRADOR.tickets, 1);
assert.equal(Number(day.totals.billedValue), 75000);
assert.equal(Number(day.totals.settledValue), 75000);
assert.equal(day.totals.accountsCharged, 3);
assert.equal(day.status, 'CUADRADO');

const deliveryFees = deliveryFeesService.summarize([
  { deliveryFee:'3500', paymentStatus:'PAGADO', paymentMethod:'EFECTIVO' },
  { deliveryFee:'5000', paymentStatus:'PAGADO', paymentMethod:'TRANSFERENCIA' },
  { deliveryFee:'4500', paymentStatus:'PAGADO', paymentMethod:'TARJETA' },
  { deliveryFee:'2500', paymentStatus:'PENDIENTE', paymentMethod:null },
  { deliveryFee:'0', paymentStatus:'PAGADO', paymentMethod:'EFECTIVO' }
]);
assert.equal(deliveryFees.count, 4);
assert.equal(Number(deliveryFees.billed), 15500);
assert.equal(Number(deliveryFees.collected), 13000);
assert.equal(Number(deliveryFees.cash), 3500);
assert.equal(Number(deliveryFees.transfer), 5000);
assert.equal(Number(deliveryFees.card), 4500);
assert.equal(Number(deliveryFees.bank), 9500);
assert.equal(Number(deliveryFees.pending), 2500);

// V127: si el domicilio histórico dice EFECTIVO pero su Pago real fue TRANSFERENCIA,
// el cierre debe usar el Pago como fuente autoritativa para el total y para el cargo externo.
const canonicalFee = deliveryFeesService.summarize([
  { deliveryFee:'3500', paymentStatus:'PAGADO', paymentMethod:'EFECTIVO', canonicalPaymentMethod:'TRANSFERENCIA' }
]);
assert.equal(Number(canonicalFee.cash), 0);
assert.equal(Number(canonicalFee.transfer), 3500);
const correction = deliveryFeesService.paymentCorrections([
  { paymentStatus:'PAGADO', paymentMethod:'EFECTIVO', canonicalPaymentMethod:'TRANSFERENCIA', canonicalPaymentAmount:'30500' }
]);
assert.equal(correction.cash, -30500);
assert.equal(correction.transfer, 30500);
const corrected = deliveryFeesService.applyPaymentCorrections(
  { cash:'130500', transfer:'66000', card:'0', credit:'0', other:'0' },
  correction
);
assert.equal(Number(corrected.cash), 100000);
assert.equal(Number(corrected.transfer), 96500);
assert.equal(Number(corrected.total), 196500);

const collectedFees = deliveryFeesService.summarize([
  { deliveryFee:'3500', paymentStatus:'PAGADO', paymentMethod:'EFECTIVO' },
  { deliveryFee:'5000', paymentStatus:'PAGADO', paymentMethod:'TRANSFERENCIA' },
  { deliveryFee:'4500', paymentStatus:'PAGADO', paymentMethod:'TARJETA' }
]);
const grossSnapshot = {
  ...snapshot,
  totals:{ ...snapshot.totals, billedValue:'88000', expectedSettlement:'88000', settledValue:'88000' },
  payments:{ cash:'53500', transfer:'30000', card:'4500', credit:'0', other:'0', total:'88000' },
  deliveryFees:collectedFees
};
const own = closeSummary.ownCloseReport(grossSnapshot);
assert.equal(own.base, 100000);
assert.equal(own.production.total, 75000);
assert.equal(own.ownSales, 75000, 'los cargos externos no pueden inflar ventas propias');
assert.equal(own.productionDifference, 0);
assert.equal(own.grossPayments.cash, 53500);
assert.equal(own.grossPayments.transfer, 30000);
assert.equal(own.grossPayments.card, 4500);
assert.equal(own.ownPayments.cash, 50000);
assert.equal(own.ownPayments.transfer, 25000);
assert.equal(own.ownPayments.card, 0);
assert.equal(own.covered, 75000);
assert.equal(own.collectionDifference, 0);
assert.equal(own.expenses.cash, 12000);
assert.equal(own.expenses.transfer, 8000);
assert.equal(own.expenses.total, 20000);
assert.equal(own.expenses.count, 2);
assert.equal(own.thirdParty.collected, 13000);
assert.equal(own.thirdParty.cash, 3500);
assert.equal(own.thirdParty.transfer, 5000);
assert.equal(own.thirdParty.card, 4500);
assert.equal(own.thirdParty.bank, 9500);

const rows = closeSummary.summaryRows(grossSnapshot);
const baseRow = rows.find((row) => row.section === 'TURNO' && row.label === 'BASE');
assert.ok(baseRow, 'la base debe aparecer arriba del resumen');
assert.match(baseRow.value, /100\.000|100,000|100000/);
assert.ok(rows.some((row) => row.section === 'VENTAS RESTAURANTE' && row.label === 'TOTAL VENTAS PROPIAS'));
assert.ok(rows.some((row) => row.section === 'RECAUDO VENTAS PROPIAS' && row.label === 'TOTAL CUBIERTO'));
assert.ok(rows.some((row) => row.section === 'RECAUDO VENTAS PROPIAS' && row.label === 'Transferencia / QR total recibida' && /30\.000|30,000|30000/.test(row.value)));
assert.ok(rows.some((row) => row.section === 'RECAUDO VENTAS PROPIAS' && row.label === 'Transferencia / QR restaurante' && /25\.000|25,000|25000/.test(row.value)));
assert.ok(rows.some((row) => row.section === 'GASTOS' && row.label === 'TOTAL GASTOS (2)' && /20\.000|20,000|20000/.test(row.value)));
assert.ok(rows.some((row) => row.section === 'FONDOS DE TERCEROS' && row.label === 'Cargos de domicilio / fondos terceros (3)' && /13\.000|13,000|13000/.test(row.value)));
assert.ok(rows.some((row) => row.section === 'FONDOS DE TERCEROS' && row.label === 'Recibidos por banco' && /9\.500|9,500|9500/.test(row.value)));
assert.equal(rows.some((row) => ['CRUCE FINAL','ARQUEO','ARQUEO FINAL'].includes(row.section)), false, 'el resumen no debe incluir arqueo final ni cruce final');

// Se conserva el cross legado para reportes detallados; no se altera contabilidad ni Tesorería.
assert.equal(closeSummary.closeCross(grossSnapshot).sales, 88000);

const root = path.resolve(__dirname, '..');
const cashRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-v2-cash.routes.js'), 'utf8');
assert.match(cashRoutes, /USER_DECISION_REQUIRED/);
assert.match(cashRoutes, /shiftClosures\.ensureSnapshot/);
assert.doesNotMatch(cashRoutes, /queueShiftCloseIntent\(req\.tenantId, shiftId\)/);
assert.match(cashRoutes, /restaurantShiftCloseHistoryC86Router/);

const publicRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-v2-cash.public.routes.js'), 'utf8');
assert.match(publicRoutes, /\/app\/cierres/);
assert.match(publicRoutes, /restaurant-shift-close-c86-cash\.js/);
assert.match(publicRoutes, /restaurant-shift-closures-c86-dashboard\.js/);

const cashUi = fs.readFileSync(path.join(root, 'src/web/restaurant-shift-close-c86-cash.js'), 'utf8');
assert.match(cashUi, /¿Imprimir resumen del cierre en la impresora POS\?/);
assert.match(cashUi, /SÍ, IMPRIMIR/);
assert.match(cashUi, />NO</);

const historyHtml = fs.readFileSync(path.join(root, 'src/web/restaurant-shift-closures-c86.html'), 'utf8');
assert.match(historyHtml, /\.c86-empty\[hidden\]\{display:none!important\}/, 'el placeholder no puede ocupar 420px cuando ya hay un cierre cargado');

const historyUi = fs.readFileSync(path.join(root, 'src/web/restaurant-shift-closures-c86.js'), 'utf8');
assert.match(historyUi, /VANTIX_RESTAURANT_CLOSE_OWN_SALES_BASE_V125/);
assert.match(historyUi, /VANTIX_RESTAURANT_CASH_CLOSE_EXPENSES_V126/);
assert.match(historyUi, /VANTIX_RESTAURANT_CLOSE_PAYMENT_SPLIT_V127/);
assert.match(historyUi, /Saldo registrado al abrir turno/);
assert.match(historyUi, /1\. Ventas del restaurante/);
assert.match(historyUi, /2\. Recaudo de ventas propias/);
assert.match(historyUi, /3\. Gastos/);
assert.match(historyUi, /4\. Fondos de terceros/);
assert.match(historyUi, /TOTAL VENTAS PROPIAS/);
assert.match(historyUi, /TOTAL GASTOS/);
assert.match(historyUi, /Transferencia \/ QR total recibida/);
assert.match(historyUi, /Recibidos por transferencia \/ QR/);
assert.doesNotMatch(historyUi, /Facturado|Liquidado \(incluye crédito\)|Efectivo esperado|Efectivo contado|Descuadre Caja/);

const runtimeUi = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-shift-close-history-c86.runtime.js'), 'utf8');
assert.match(runtimeUi, /deliveryFeeTotalsForDayReport/);
assert.match(runtimeUi, /deliveryFees\.reconcileForShift/);
assert.match(runtimeUi, /deliveryFees\.applyPaymentCorrections/);
assert.match(runtimeUi, /canonicalMethods/);

console.log('Restaurant shift closures C86 V127 smoke: OK');
