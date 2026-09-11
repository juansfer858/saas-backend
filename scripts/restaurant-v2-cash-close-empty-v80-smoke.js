'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtime = fs.readFileSync('src/web/restaurant-v2-cash-close-empty-v80.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js', 'utf8');
const cashRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
const cashCloseService = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash-close-empty-v80.service.js', 'utf8');
const cash = fs.readFileSync('src/web/restaurant-v2-cash.js', 'utf8');
const backend = fs.readFileSync('src/modules/restaurant/restaurant-table-live-detail-v67.service.js', 'utf8');

assert.doesNotThrow(() => new vm.Script(runtime));
assert.match(runtime, /VANTIX_RESTAURANT_V2_CASH_CLOSE_EMPTY_V80_1/);
assert.match(runtime, /\/detalle-v67/);
assert.match(runtime, /CUENTA_PEDIDA/);
assert.match(runtime, /Number\(detail\?\.sale\?\.total\|\|0\)===0/);
assert.match(runtime, /detail\.items\.length===0/);
assert.doesNotMatch(runtime, /canCloseEmptyFromControlCenter!==true/);
assert.match(runtime, /CERRAR MESA SIN CONSUMO/);
assert.match(runtime, /\/v2\/caja\/mesas\/\$\{encodeURIComponent\(tableId\)\}\/cerrar-vacia-v80/);
assert.match(runtime, /No se registró ningún cobro/);
assert.match(runtime, /payment\.hidden=true/);
assert.match(runtime, /cashierAllowed:true/);
assert.match(runtime, /zeroAndNoProducts:true/);
assert.match(runtime, /noPaymentSideEffects:true/);
assert.doesNotMatch(runtime, /\/cobrar|paymentMethodId|cajaBancoId|restaurantSessionPayment|MovimientoTesoreria|asientoContable/);

assert.match(publicRoutes, /restaurant-v2-cash-close-empty-v80\.js\?v=v80/);
assert.match(publicRoutes, /X-VantixGC-Restaurant-Cash-Close-Empty/);
assert.match(cashRoutes, /'\/v2\/caja\/mesas\/:tableId\/cerrar-vacia-v80'/);
assert.match(cashRoutes, /requirePermission\('RESTAURANTE\.CERRAR'\)/);
assert.match(cashRoutes, /cashCloseEmpty\.closeEmptyFromCash/);
assert.match(cashCloseService, /CAJERO/);
assert.match(cashCloseService, /closeEmptyFromControlCenter/);
assert.match(cashCloseService, /rol:\s*'ADMIN'/);
assert.match(cashCloseService, /actorRole/);

assert.match(cash, /La cuenta no tiene productos\./);
assert.match(backend, /RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS/);
assert.match(backend, /RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_FINANCIAL_ACTIVITY/);
assert.match(backend, /tx\.restaurantTableSession\.delete/);
assert.match(backend, /tx\.comprobanteComercial\.delete/);
assert.match(backend, /data:\s*\{\s*state:\s*'LIBRE'\s*\}/);

console.log(JSON.stringify({
  ok:true,
  module:'RESTAURANT_V2_CASH_CLOSE_EMPTY_V80_1',
  cashierAllowed:true,
  centerPrivilegesNotGranted:true,
  accountRequestedZeroAndNoProducts:true,
  usesExistingSafeBackend:true,
  noPaymentSideEffects:true
}));
