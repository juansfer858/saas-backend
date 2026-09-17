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

const snapshot = {
  marker: service.MARKER,
  businessDate: '2026-09-11',
  status: 'CUADRADO',
  shift: { id: 'shift-1', cajaNombre: 'Caja principal', cajero: 'Caja', abiertoEn: '2026-09-11T13:00:00.000Z', cerradoEn: '2026-09-12T02:30:00.000Z' },
  channels: {
    MESAS: { tickets: 2, deliveredItems: '4', kitchenItems: '3', productionValue: '50000', billedValue: '60000', tips: '0', expectedSettlement: '60000', settledValue: '60000' },
    MOSTRADOR: { tickets: 1, deliveredItems: '1', kitchenItems: '1', productionValue: '15000', billedValue: '15000', tips: '0', expectedSettlement: '15000', settledValue: '15000' },
    DOMICILIOS: { tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0', billedValue: '0', tips: '0', expectedSettlement: '0', settledValue: '0' },
    PARA_LLEVAR: { tickets: 0, deliveredItems: '0', kitchenItems: '0', productionValue: '0', billedValue: '0', tips: '0', expectedSettlement: '0', settledValue: '0' }
  },
  totals: { tickets: 3, deliveredItems: '5', kitchenItems: '4', productionValue: '65000', billedValue: '75000', tips: '0', expectedSettlement: '75000', settledValue: '75000', difference: '0', accountsCharged: 3, kitchenDeliveredItems: '4' },
  production: {
    COCINA: { station: 'COCINA', commands: 2, deliveredItems: '4', value: '65000', readyNotDelivered: 0 },
    BARRA: { station: 'BARRA', commands: 0, deliveredItems: '0', value: '0', readyNotDelivered: 0 },
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
assert.equal(Number(deliveryFees.bank), 9500);
assert.equal(Number(deliveryFees.pending), 2500);

const summaryWithDelivery = { ...snapshot, deliveryFees, expenses:{ cash:'0', transfer:'0', total:'0', count:0 } };
const deliveryRows = closeSummary.summaryRows(summaryWithDelivery).filter((row) => row.section === 'DOMICILIOS');
assert.equal(deliveryRows.length, 2);
assert.match(deliveryRows[0].label, /Cargo domicilio/);
assert.match(deliveryRows[0].value, /3\.500|3,500|3500/);
assert.equal(closeSummary.closeCross(summaryWithDelivery).sales, 75000, 'el cargo de domicilio ya está dentro de ventas y no se resta de nuevo');
assert.equal(closeSummary.closeCross(summaryWithDelivery).salesMinusExpenses, 75000, 'sin gasto registrado no debe fabricarse una salida');

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
assert.match(historyUi, /Exportar Excel/);
assert.match(historyUi, /Exportar PDF/);
assert.match(historyUi, /Imprimir resumen POS/);
assert.match(historyUi, /Platos cocina entregados/);
assert.match(historyUi, /MOSTRADOR/);
assert.match(historyUi, /Cargos de domicilio/);
assert.match(historyUi, /ya incluido en Ventas/);

const runtimeUi = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-shift-close-history-c86.runtime.js'), 'utf8');
assert.match(runtimeUi, /deliveryFeeTotalsForDayReport/);
assert.match(runtimeUi, /deliveryFees:await deliveryFees\.summaryForShift/);

console.log('Restaurant shift closures C86 smoke: OK');

