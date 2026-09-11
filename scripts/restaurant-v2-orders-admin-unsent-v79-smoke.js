'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const route = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.routes.js', 'utf8');
const service = fs.readFileSync('src/modules/restaurant/restaurant-v2-orders-admin-draft.service.js', 'utf8');
const ui = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');

assert.match(route, /router\.delete\('\/v2\/sesiones\/:sessionId\/pedido\/items\/:itemId'/);
assert.match(route, /requirePermission\('PEDIDOS\.CREAR'\)/);
assert.match(route, /removeUnsentWaiterDraftItem/);

assert.match(service, /prisma\.\$transaction/);
assert.match(service, /source:\s*'MESERO'/);
assert.match(service, /state:\s*'BORRADOR'/);
assert.match(service, /RESTAURANT_DRAFT_ITEM_ALREADY_SENT/);
assert.match(service, /restaurantOrderItem\.delete/);
assert.match(service, /detalleComprobante\.delete/);
assert.match(service, /subtotal:\s*\{\s*decrement:/);
assert.match(service, /ivaTotal:\s*\{\s*decrement:/);
assert.match(service, /impoconsumoTotal:\s*\{\s*decrement:/);
assert.match(service, /total:\s*\{\s*decrement:/);
assert.doesNotMatch(service, /restaurantCommand\.create|notifyLatestRound|PRINT_QUEUE|cajaBanco|cartera|asientoContable/);

assert.match(ui, /VANTIX_RESTAURANT_V2_ADMIN_UNSENT_REMOVE_V79/);
assert.match(ui, /function allUnsentItems\(\)/);
assert.match(ui, /item\.source==='MESERO'&&item\.orderState==='BORRADOR'/);
assert.match(ui, /Pendientes sin enviar de otro mesero/);
assert.match(ui, /data-remove-unsent/);
assert.match(ui, /method:'DELETE'/);
assert.match(ui, /Solo se retirará porque aún NO ha sido enviado/);
assert.match(ui, /filter\(x=>x\.orderState!=='BORRADOR'\)/);

console.log(JSON.stringify({
  ok: true,
  module: 'RESTAURANT_V2_ORDERS_ADMIN_UNSENT_V79',
  draftOnly: true,
  sentProtected: true,
  noKitchenSideEffects: true,
  noFinancialBoundaryCrossing: true
}));
