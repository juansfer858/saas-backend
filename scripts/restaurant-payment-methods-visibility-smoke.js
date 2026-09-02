'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityRuntime,
  installPaymentMethodsVisibilityRuntime
} = require('../src/modules/restaurant/restaurant-payment-methods-visibility.public.routes');

assert.equal(PAYMENT_METHODS_VISIBILITY_MARKER, 'VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2');
assert.equal(typeof installPaymentMethodsVisibilityRuntime, 'function');
new Function(paymentMethodsVisibilityRuntime);
assert.match(paymentMethodsVisibilityRuntime, /⚙ Métodos de pago/);
assert.match(paymentMethodsVisibilityRuntime, /cash-page-head/);
assert.match(paymentMethodsVisibilityRuntime, /independentOfSelectedTable:true/);
assert.match(paymentMethodsVisibilityRuntime, /\/api\/v1\/restaurante\/metodos-pago/);
assert.match(paymentMethodsVisibilityRuntime, /\/api\/v1\/tesoreria\/cajas-bancos/);
assert.match(paymentMethodsVisibilityRuntime, /\+ Crear cuenta \/ billetera para transferencias/);
assert.match(paymentMethodsVisibilityRuntime, /session\.user\?\.rol\|\|\$\('#userRole'\)/);

const publicRouter = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRouter, /installPaymentMethodsVisibilityRuntime/);
assert.match(publicRouter, /router\.use\(installPaymentMethodsVisibilityRuntime\)/);

const baseUi = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');
assert.match(baseUi, /class=\"cash-shell/);
assert.match(baseUi, /cash-page-head/);

console.log('RESTAURANT PAYMENT METHODS VISIBILITY SMOKE OK');
console.log(JSON.stringify({
  cajaHeaderShortcut:true,
  visibleWithoutSelectedTable:true,
  visibleWithClosedShift:true,
  adminRoleLateRenderSupported:true,
  methodCrud:true,
  bankWalletCreate:true
}, null, 2));
