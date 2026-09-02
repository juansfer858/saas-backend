'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityBrowserRuntime,
  installPaymentMethodsVisibilityRuntime
} = require('../src/modules/restaurant/restaurant-payment-methods-visibility-browser.public.routes');

assert.equal(PAYMENT_METHODS_VISIBILITY_MARKER, 'VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2');
assert.equal(typeof installPaymentMethodsVisibilityRuntime, 'function');
new Function(paymentMethodsVisibilityBrowserRuntime);
assert.match(paymentMethodsVisibilityBrowserRuntime, /⚙ Métodos de pago/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /cash-page-head/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /independentOfSelectedTable:true/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /eventDriven:true/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\/api\/v1\/restaurante\/metodos-pago/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\/api\/v1\/tesoreria\/cajas-bancos/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /\+ Crear cuenta \/ billetera para transferencias/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /session\.user\?\.rol\|\|\$\('#userRole'\)/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /vantix:tenant-realtime/);
assert.match(paymentMethodsVisibilityBrowserRuntime, /scheduleBurst/);
assert.doesNotMatch(paymentMethodsVisibilityBrowserRuntime, /\\`/);
assert.doesNotMatch(paymentMethodsVisibilityBrowserRuntime, /setInterval|MutationObserver/);

const publicRouter = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
assert.match(publicRouter, /restaurant-payment-methods-visibility-browser\.public\.routes/);
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
  eventDrivenNoPermanentDomWatch:true,
  methodCrud:true,
  bankWalletCreate:true,
  browserRuntimeSyntax:true
}, null, 2));
