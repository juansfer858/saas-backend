'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const addon = read('src/web/restaurant-v2-kds-stations-v23.js');
const html = read('src/web/restaurant-v2-kds.html');
const productionDevice = read('src/web/restaurant-v2-production-p8.html');
const publicRoutes = read('src/modules/restaurant/restaurant-v2-kds.public.routes.js');
const printingRoutes = read('src/modules/platform/printing/printing.routes.js');
const stationService = read('src/modules/platform/printing/printing-stations.service.js');

assert.match(addon, /VANTIX_RESTAURANT_V2_KDS_STATIONS_V23/);
assert.match(addon, /\/app\/restaurante-v2\/kds/);
assert.match(addon, /new Set\(\['ADMIN','SUPER_ADMIN'\]\)/);
assert.doesNotMatch(addon, /new Set\(\[[^\]]*'COCINA'/);
assert.doesNotMatch(addon, /new Set\(\[[^\]]*'BARRA'/);
assert.doesNotMatch(addon, /new Set\(\[[^\]]*'POSTRES'/);

for (const token of [
  '+ Crear estación',
  '+ Nueva estación',
  'Estaciones de producción',
  'Nueva estación',
  'COCINA', 'BARRA', 'POSTRES',
  'KDS', 'IMPRESORA', 'AMBOS',
  '/api/v1/impresion/estaciones',
  "method:current?'PATCH':'POST'",
  "method:'DELETE'",
  "body:JSON.stringify({active:true})",
  "document.querySelector('#refresh')?.click()"
]) assert.ok(addon.includes(token), `Falta contrato V23: ${token}`);

assert.ok(html.includes('/app/restaurant-v2-kds-stations-v23.js?v=v23'));
assert.ok(publicRoutes.includes("router.get('/app/restaurant-v2-kds-stations-v23.js'"));
assert.ok(publicRoutes.includes("'restaurant-v2-kds-stations-v23.js'"));

// La PWA de producción vinculada sigue siendo sólo operativa. La administración vive
// en el KDS del Centro de Control, no en la pantalla de cocina/barra del empleado.
assert.equal(productionDevice.includes('restaurant-v2-kds-stations-v23.js'), false);

// Reutiliza el servicio canónico ya auditado; no crea una segunda fuente de estaciones.
assert.ok(printingRoutes.includes("router.get('/estaciones'"));
assert.ok(printingRoutes.includes("router.post('/estaciones'"));
assert.ok(printingRoutes.includes("router.patch('/estaciones/:id'"));
assert.ok(printingRoutes.includes("router.delete('/estaciones/:id'"));
assert.ok(printingRoutes.includes("requirePermission('CONFIGURACION.EDITAR')"));
assert.ok(stationService.includes('auditoriaContable.create'));
assert.ok(stationService.includes("'PRINT_STATION_DUPLICATE_NAME'"));
assert.ok(stationService.includes('restaurantProductionStation.create'));

new Function(addon);
console.log('RESTAURANT V2 KDS STATIONS V23 SMOKE OK');
console.log(JSON.stringify({
  adminOnly:true,
  create:true,
  edit:true,
  deactivate:true,
  reactivate:true,
  canonicalPrintingStationService:true,
  productionDeviceStillRoleFocused:true
}, null, 2));
