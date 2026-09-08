const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MARKER, patchWaiterRuntime } = require('../src/modules/restaurant/restaurant-joint-split-v73.public.routes');

const runtimePath = path.join(__dirname, '../src/web/restaurant-waiter-runtime-v7.js');
const source = fs.readFileSync(runtimePath, 'utf8');
const patched = patchWaiterRuntime(source);

assert.notEqual(patched, source, 'V73 debe modificar el runtime base del Mesero');
assert.match(patched, new RegExp(MARKER));
assert.match(patched, /const seatSelector = billingMode\(\) === 'INDIVIDUAL'/);
assert.match(patched, /data-move=/);
assert.match(patched, /aria-label="Asignar producto a persona"/);
assert.match(patched, /const noteButton = item\.orderState === 'BORRADOR'/);
assert.ok(!patched.includes("${item.orderState === 'BORRADOR' ? `<div style=\"grid-column:1/-1;display:flex;gap:6px\"><button"), 'el selector por persona no debe seguir limitado al borrador');

const flex = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-waiter-service-flex-v9.js'), 'utf8');
assert.match(flex, /VANTIX_WAITER_FLEXIBLE_BILLING_V10/);
assert.match(flex, /targetMode === 'INDIVIDUAL' \? 1 : null/);

const identity = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-identity.service.js'), 'utf8');
assert.match(identity, /seatNumber/);
assert.match(identity, /RESTAURANT_SEAT_INVALID/);

const payments = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-visit-payments.service.js'), 'utf8');
assert.match(payments, /BY_SEAT/);
assert.match(payments, /BY_ITEMS/);

const routes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant.routes.js'), 'utf8');
assert.match(routes, /\/sesiones\/:sessionId\/items\/:itemId/);
assert.match(routes, /requirePermission\('PEDIDOS', 'CREAR'\)/);

console.log('RESTAURANT JOINT SPLIT V73 SMOKE OK');
