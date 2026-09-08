'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('src/modules/restaurant/restaurant-test-data-reset-v66.service.js');
const routes = read('src/modules/restaurant/restaurant-test-data-reset-v66.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const ui = read('src/web/restaurant-company-admin-advanced.js');

assert.match(service, /VANTIX_RESTAURANT_TEST_DATA_RESET_V66/);
assert.match(service, /DEMO_SUBDOMAIN = 'demo-restaurante'/);
assert.match(service, /CONFIRMATION = 'ELIMINAR PRUEBAS'/);
assert.match(service, /RESTAURANT_TEST_RESET_DEMO_ONLY/);
assert.match(service, /environment: 'PRODUCCION'/);
assert.match(service, /RESTAURANT_TEST_RESET_REAL_DIAN_BLOCK/);

for (const delegate of [
  'restaurantTableSession',
  'restaurantOrder',
  'restaurantOrderItem',
  'restaurantCommand',
  'restaurantFiscalDocument',
  'restaurantSessionPayment',
  'restaurantDeliveryOrder',
  'comprobanteComercial',
  'detalleComprobante',
  'pago',
  'cartera',
  'movimientoCartera',
  'movimientoTesoreria',
  'movimientoInventario',
  'asientoContable',
  'detalleAsiento',
  'aperturaCierreCaja',
  'consumptionRun'
]) {
  assert.match(service, new RegExp(`['"]${delegate}['"]`), `missing transactional cleanup for ${delegate}`);
}

assert.match(service, /restaurantTable\.updateMany\(\{ where: \{ tenantId \}, data: \{ state: 'LIBRE' \} \}\)/);
assert.match(service, /cajaBanco\.updateMany\(\{ where: \{ tenantId \}, data: \{ saldoActual: 0 \} \}\)/);
assert.match(service, /productsAreNotUpdated: true/);

// Master data must never be removed or rewritten by this reset.
for (const forbidden of [
  /producto\.delete/i,
  /producto\.update/i,
  /restaurantMenuItem\.delete/i,
  /restaurantMenuItem\.update/i,
  /consumptionRecipe\.delete/i,
  /consumptionRecipe\.update/i,
  /restaurantZone\.delete/i,
  /restaurantZone\.update/i,
  /\buser\.delete/i,
  /\buser\.update/i,
  /tercero\.delete/i,
  /tercero\.update/i,
  /printerEndpoint\.delete/i,
  /restaurantConfig\.delete/i,
  /notificationPushDevice\.delete/i
]) {
  assert.doesNotMatch(service, forbidden);
}

assert.match(routes, /\/limpieza-pruebas\/v66\/resumen/);
assert.match(routes, /\/limpieza-pruebas\/v66\/ejecutar/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(coreRoutes, /restaurantTestDataResetV66Router/);
assert.match(coreRoutes, /router\.use\('\/restaurante', restaurantTestDataResetV66Router\)/);

assert.match(ui, /VANTIX_RESTAURANT_TEST_DATA_RESET_V66/);
assert.match(ui, /Limpieza de pruebas/);
assert.match(ui, /Eliminar facturas, comandas y transacciones de prueba/);
assert.match(ui, /No toca los maestros/);
assert.match(ui, /productos y sus existencias actuales/i);
assert.match(ui, /demo-restaurante/);
assert.match(ui, /ELIMINAR PRUEBAS/);
assert.match(ui, /\/api\/v1\/restaurante\/limpieza-pruebas\/v66\/resumen/);
assert.match(ui, /\/api\/v1\/restaurante\/limpieza-pruebas\/v66\/ejecutar/);

console.log('RESTAURANT TEST DATA RESET V66 SMOKE OK', JSON.stringify({
  demoOnly:true,
  adminPermission:true,
  typedConfirmation:true,
  blocksProductionDian:true,
  removesCommercialDocuments:true,
  removesRestaurantCommands:true,
  removesPaymentsAndAccounting:true,
  preservesProducts:true,
  preservesMenuAndRecipes:true,
  preservesTablesAndZones:true,
  preservesUsersAndThirdParties:true,
  preservesPrintersAndPushDevices:true
}));
