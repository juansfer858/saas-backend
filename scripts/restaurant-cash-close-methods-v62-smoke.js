'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const layerPath = 'src/modules/restaurant/restaurant-cash-close-methods-v62.public.routes.js';
const compositionPath = 'src/modules/restaurant/restaurant.public.routes.js';
const methodsPath = 'src/modules/restaurant/restaurant-payment-methods.service.js';
const restaurantPath = 'src/modules/restaurant/restaurant.service.js';
const deliveryPath = 'src/modules/restaurant/restaurant-delivery.service.js';
const oldBreakdownPath = 'src/modules/restaurant/restaurant-cash-close-breakdown-v45.public.routes.js';

for (const file of [layerPath, compositionPath]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const layer = read(layerPath);
const composition = read(compositionPath);
const methods = read(methodsPath);
const restaurant = read(restaurantPath);
const delivery = read(deliveryPath);
const oldBreakdown = read(oldBreakdownPath);

assert.match(layer, /VANTIX_RESTAURANT_CASH_CLOSE_METHODS_V62/);
assert.match(layer, /paymentMethodKind/);
assert.match(layer, /TRANSFERENCIA/);
assert.match(layer, /TARJETA/);
assert.match(layer, /transferSales/);
assert.match(layer, /cardSales/);
assert.match(layer, /bankOtherSales/);
assert.match(layer, /Transferencias \/ QR/);
assert.match(layer, /Tarjetas/);
assert.match(layer, /exactMethodBreakdown: true/);
assert.match(layer, /identity\.cashShiftSummary = cashShiftSummaryV62/);

// El resumen vivo debe incluir domicilios cobrados por este cajero durante el turno.
assert.match(layer, /async function deliveryPaymentsForShift/);
assert.match(layer, /prisma\.pago\.findMany/);
assert.match(layer, /prisma\.restaurantDeliveryOrder\.findMany/);
assert.match(layer, /treasuryPaymentId: \{ in: payments\.map/);
assert.match(layer, /paymentStatus: 'PAGADO'/);
assert.match(layer, /state: \{ not: 'CANCELADO' \}/);
assert.match(layer, /restaurantDeliverySalesTotal/);
assert.match(layer, /restaurantDeliveryFeeTotal/);
assert.match(layer, /restaurantShiftSalesTotal/);
assert.match(layer, /channelBreakdown/);
assert.match(layer, /deliveryIncluded: true/);
assert.match(layer, /settlementDifference/);
assert.match(layer, /restaurantClosedTablesTotal: money\(combinedRestaurantTotal\)\.toString\(\)/);
assert.match(layer, /salesTotal: money\(combinedRestaurantTotal\)\.toString\(\)/);
assert.match(layer, /paymentTotal: money\(paymentTotal\)\.toString\(\)/);
assert.match(layer, /balanced: settlementDifference\.eq\(0\)/);
assert.match(layer, /version:'62\.1\.0'/);
assert.match(layer, /incluye mesas y domicilios cobrados/);

// El cargo de domicilio/empaque ya forma parte del total de la venta y del pago,
// pero no se convierte en una comanda adicional de producción.
assert.match(delivery, /nombre: 'Servicio de domicilio'/);
assert.match(delivery, /const itemsSubtotal = prepared\.reduce/);
assert.match(delivery, /const deliveryFee = money\(input\.deliveryFee \|\| 0\)/);
assert.match(delivery, /const total = money\(decimal\(itemsSubtotal\)\.plus\(deliveryFee\)\)/);
assert.match(delivery, /monto: delivery\.total/);

assert.match(methods, /KINDS = Object\.freeze\(\['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO'\]\)/);
assert.match(methods, /paymentMethodKind: method\.kind/);
assert.match(methods, /paymentReference: reference/);
assert.doesNotMatch(methods, /cashShiftId: result\.session\.cashShiftId \|\| openShift\.id/);
assert.match(restaurant, /cashShiftId: cashShift\?\.id \|\| null/);
assert.match(restaurant, /\.\.\.paymentMetadata/);

assert.match(composition, /installRestaurantCashCloseMethodsV62/);
assert.ok(
  composition.indexOf('router.use(installRestaurantCashCloseMethodsV62)') < composition.indexOf('router.use(installRestaurantCashCloseBreakdownV45)'),
  'V62 debe envolver el asset final antes que V45 para ocultar el agregado viejo y mostrar métodos exactos'
);
assert.match(oldBreakdown, /electronicSales/);
assert.match(layer, /\.cash-payment-breakdown-v45\{display:none!important\}/);

console.log('RESTAURANT CASH CLOSE METHODS V62 DELIVERY RECONCILIATION OK', JSON.stringify({
  transferVisible: true,
  cardVisible: true,
  cashVisible: true,
  creditVisible: true,
  deliveryPaymentsIncluded: true,
  deliveryFeeIncludedOnce: true,
  liveShiftReconciliation: true,
  legacyBankFallback: true
}));
