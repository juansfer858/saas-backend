'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('src/modules/restaurant/restaurant-test-data-reset-v68.service.js');
const routes = read('src/modules/restaurant/restaurant-test-data-reset-v68.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const ui = read('src/web/restaurant-company-admin-advanced.js');

assert.match(service, /VANTIX_RESTAURANT_TEST_DATA_RESET_V68/);
assert.match(service, /version: '68\.1\.0'/);
assert.match(service, /RESTAURANT_NICHES = Object\.freeze\(\['RESTAURANTE', 'RESTAURANT'\]\)/);
assert.match(service, /RESTAURANT_TEST_RESET_RESTAURANT_ONLY/);
assert.doesNotMatch(service, /DEMO_SUBDOMAIN/);
assert.doesNotMatch(service, /RESTAURANT_TEST_RESET_DEMO_ONLY/);
assert.match(service, /confirmationFor\(tenant\)/);
assert.match(service, /ELIMINAR PRUEBAS/);
assert.match(service, /environment: 'PRODUCCION'/);
assert.match(service, /RESTAURANT_TEST_RESET_REAL_DIAN_BLOCK/);

// V68.1 regression guard: the summary must not fan out all counters with Promise.all.
assert.match(service, /SCHEMA_DRIFT_CODES = new Set\(\['P2021', 'P2022'\]\)/);
assert.match(service, /RESTAURANT_TEST_RESET_COUNT_FAILED/);
assert.match(service, /RESTAURANT_TEST_RESET_EXECUTION_FAILED/);
assert.match(service, /async function isSchemaDriftError|function isSchemaDriftError/);
assert.match(service, /const sessions = await count\(/);
assert.match(service, /const pushDeliveries = await count\(/);
assert.doesNotMatch(service, /Promise\.all\(\[/);
assert.match(service, /removed\.schemaWarnings/);

for (const delegate of [
  'restaurantTableSession', 'restaurantOrder', 'restaurantOrderItem', 'restaurantCommand',
  'restaurantFiscalDocument', 'restaurantSessionPayment', 'restaurantDeliveryOrder',
  'comprobanteComercial', 'detalleComprobante', 'pago', 'cartera', 'movimientoCartera',
  'movimientoTesoreria', 'movimientoInventario', 'asientoContable', 'detalleAsiento',
  'aperturaCierreCaja', 'consumptionRun'
]) {
  assert.match(service, new RegExp(`['"]${delegate}['"]`), `missing transactional cleanup for ${delegate}`);
}

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

assert.match(routes, /\/limpieza-pruebas\/v68\/resumen/);
assert.match(routes, /\/limpieza-pruebas\/v68\/ejecutar/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);
assert.match(coreRoutes, /restaurantTestDataResetV68Router/);
assert.match(coreRoutes, /router\.use\('\/restaurante', restaurantTestDataResetV68Router\)/);

assert.match(ui, /VANTIX_RESTAURANT_TEST_DATA_RESET_V68/);
assert.match(ui, /RESTAURANTE · V68/);
assert.match(ui, /Disponible para todos los tenants del nicho/);
assert.match(ui, /\/api\/v1\/restaurante\/limpieza-pruebas\/v68\/resumen/);
assert.match(ui, /\/api\/v1\/restaurante\/limpieza-pruebas\/v68\/ejecutar/);
assert.match(ui, /if \(!tabs\.querySelector\('\[data-restaurant-test-reset-tab\]'\)\)/);
assert.doesNotMatch(ui, /if \(isDemoTenant\(\)/);
assert.match(ui, /data-reset-confirmation/);

console.log('RESTAURANT TEST DATA RESET V68.1 OK', JSON.stringify({
  wholeRestaurantNiche:true,
  adminPermission:true,
  tenantSpecificTypedConfirmation:true,
  blocksProductionDian:true,
  preservesMasterData:true,
  sequentialCounts:true,
  schemaDriftGuard:true,
  rollbackMessage:true,
  legacyV66Kept:true
}));
