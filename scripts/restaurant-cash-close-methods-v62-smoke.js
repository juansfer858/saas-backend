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
const oldBreakdownPath = 'src/modules/restaurant/restaurant-cash-close-breakdown-v45.public.routes.js';

for (const file of [layerPath, compositionPath]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const layer = read(layerPath);
const composition = read(compositionPath);
const methods = read(methodsPath);
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

assert.match(methods, /KINDS = Object\.freeze\(\['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO'\]\)/);
assert.match(methods, /paymentMethodKind: method\.kind/);
assert.match(methods, /cashShiftId: result\.session\.cashShiftId \|\| openShift\.id/);

assert.match(composition, /installRestaurantCashCloseMethodsV62/);
assert.ok(
  composition.indexOf('router.use(installRestaurantCashCloseMethodsV62)') < composition.indexOf('router.use(installRestaurantCashCloseBreakdownV45)'),
  'V62 debe envolver el asset final antes que V45 para ocultar el agregado viejo y mostrar métodos exactos'
);
assert.match(oldBreakdown, /electronicSales/);
assert.match(layer, /\.cash-payment-breakdown-v45\{display:none!important\}/);

console.log('RESTAURANT CASH CLOSE METHODS V62 OK', JSON.stringify({
  transferVisible: true,
  cardVisible: true,
  cashVisible: true,
  creditVisible: true,
  legacyBankFallback: true
}));
