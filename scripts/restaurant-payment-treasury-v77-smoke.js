'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const cashRuntime = read('src/web/restaurant-v2-payment-methods-v77.js');
const cashPublic = read('src/modules/restaurant/restaurant-v2-cash.public.routes.js');
const treasuryRuntime = read('src/web/treasury-payment-destinations-v77.js');
const commercialRoutes = read('src/modules/commercial/commercial.routes.js');
const paymentService = read('src/modules/restaurant/restaurant-payment-methods.service.js');

assert.match(cashRuntime, /VANTIX_RESTAURANT_V2_PAYMENT_METHODS_V77/);
assert.match(cashRuntime, /Gestionar métodos de pago/);
assert.match(cashRuntime, /\/api\/v1\/restaurante\/metodos-pago/);
assert.match(cashRuntime, /\/api\/v1\/tesoreria\/cajas-bancos/);
assert.match(cashRuntime, /kind==='EFECTIVO'\?'CAJA':'BANCO'/);
assert.match(cashRuntime, /kind==='CREDITO'\?null/);
assert.match(cashRuntime, /saldoActual:0/);
assert.match(cashRuntime, /Pago mixto:/);
assert.match(cashRuntime, /no lo simula con cobros consecutivos/);
assert.doesNotMatch(cashRuntime, /\/clientes|\/terceros|cupoCredito|diasPlazo/);

assert.match(cashPublic, /restaurant-v2-payment-methods-v77\.js/);
assert.match(cashPublic, /X-VantixGC-Restaurant-Payment-Methods/);
assert.doesNotMatch(cashPublic, /restaurant-v2-cash-tender-v18\.js/);

assert.match(treasuryRuntime, /VANTIX_TREASURY_PAYMENT_DESTINATIONS_V77/);
assert.match(treasuryRuntime, /\+ Crear caja/);
assert.match(treasuryRuntime, /\+ Crear banco/);
assert.match(treasuryRuntime, /\/api\/v1\/tesoreria\/cajas-bancos/);
assert.match(treasuryRuntime, /saldoActual:0/);
assert.doesNotMatch(treasuryRuntime, /\/cartera|\/terceros|\/contabilidad/);

assert.match(commercialRoutes, /treasury-payment-destinations-v77\.js/);
assert.match(commercialRoutes, /VANTIX_TREASURY_PAYMENT_DESTINATIONS_V77/);
assert.match(commercialRoutes, /X-VantixGC-Treasury-Payment-Destinations/);

for (const kind of ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO']) {
  assert.ok(paymentService.includes(`'${kind}'`), `Falta contrato existente ${kind}`);
}
assert.doesNotMatch(paymentService, /MIXTO/);

console.log('Restaurant Payment/Treasury V77 smoke: OK');
