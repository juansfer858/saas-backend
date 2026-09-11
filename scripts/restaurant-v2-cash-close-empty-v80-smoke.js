'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtime = fs.readFileSync('src/web/restaurant-v2-cash-close-empty-v80.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js', 'utf8');
const cash = fs.readFileSync('src/web/restaurant-v2-cash.js', 'utf8');
const backend = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.service.js', 'utf8');
const backendRoutes = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.routes.js', 'utf8');

assert.doesNotThrow(() => new vm.Script(runtime));
assert.match(runtime, /VANTIX_RESTAURANT_V2_CASH_CLOSE_EMPTY_V80/);
assert.match(runtime, /\/detalle-v67/);
assert.match(runtime, /canCloseEmptyFromControlCenter!==true/);
assert.match(runtime, /CUENTA_PEDIDA/);
assert.match(runtime, /CERRAR MESA SIN CONSUMO/);
assert.match(runtime, /\/cerrar-vacia-v21/);
assert.match(runtime, /No se registró ningún cobro/);
assert.match(runtime, /payment\.hidden=true/);
assert.match(runtime, /accountRequestedOnly:true/);
assert.match(runtime, /noPaymentSideEffects:true/);
assert.doesNotMatch(runtime, /\/cobrar|paymentMethodId|cajaBancoId|restaurantSessionPayment|MovimientoTesoreria|asientoContable/);

assert.match(publicRoutes, /restaurant-v2-cash-close-empty-v80\.js\?v=v80/);
assert.match(publicRoutes, /X-VantixGC-Restaurant-Cash-Close-Empty/);
assert.match(publicRoutes, /router\.get\('\/app\/restaurant-v2-cash-close-empty-v80\.js'/);

assert.match(cash, /La cuenta no tiene productos\./);
assert.match(backend, /canCloseEmptyFromControlCenter/);
assert.match(backend, /closeEmptyFromControlCenter/);
assert.match(backend, /RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS/);
assert.match(backend, /RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_FINANCIAL_ACTIVITY/);
assert.match(backend, /tx\.restaurantTableSession\.delete/);
assert.match(backend, /tx\.comprobanteComercial\.delete/);
assert.match(backend, /data:\s*\{\s*state:\s*'LIBRE'\s*\}/);
assert.match(backendRoutes, /'\/mesas\/:id\/cerrar-vacia-v21'/);

console.log(JSON.stringify({
  ok:true,
  module:'RESTAURANT_V2_CASH_CLOSE_EMPTY_V80',
  usesExistingSafeBackend:true,
  accountRequestedOnly:true,
  paymentCardReplacedOnlyWhenEligible:true,
  noPaymentSideEffects:true
}));
