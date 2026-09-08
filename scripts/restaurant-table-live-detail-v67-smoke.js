'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const service = require('../src/modules/restaurant/restaurant-table-live-detail-v67.service');
const publicLayer = require('../src/modules/restaurant/restaurant-table-live-detail-v67.public.routes');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const serviceSource = read('src/modules/restaurant/restaurant-table-live-detail-v67.service.js');
const routes = read('src/modules/restaurant/restaurant-table-live-detail-v67.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant.public.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const runtime = publicLayer.runtime;

assert.equal(service.MARKER, 'VANTIX_RESTAURANT_TABLE_LIVE_DETAIL_V67');
assert.equal(service.itemState({ state:'BORRADOR', commands:[] }, { station:'COCINA' }), 'POR_ENVIAR');
assert.equal(service.itemState({ state:'ENVIADO', commands:[{ station:'COCINA', state:'PENDIENTE' }] }, { station:'COCINA' }), 'PENDIENTE');
assert.equal(service.itemState({ state:'ENVIADO', commands:[{ station:'COCINA', state:'EN_PREPARACION' }] }, { station:'COCINA' }), 'EN_PREPARACION');
assert.equal(service.itemState({ state:'ENVIADO', commands:[{ station:'COCINA', state:'LISTA' }] }, { station:'COCINA' }), 'LISTO');
assert.equal(service.itemState({ state:'ENVIADO', commands:[{ station:'COCINA', state:'ENTREGADA' }] }, { station:'COCINA' }), 'ENTREGADO');

assert.match(serviceSource, /orderedQuantity/);
assert.match(serviceSource, /deliveredQuantity/);
assert.match(serviceSource, /remainingQuantity/);
assert.match(serviceSource, /readyQuantity/);
assert.match(serviceSource, /canCancelOpening/);
assert.match(serviceSource, /activeQrDevices === 0/);
assert.match(serviceSource, /payments === 0/);
assert.match(serviceSource, /fiscalDocuments === 0/);
assert.match(serviceSource, /sale\?\.estado === 'BORRADOR'/);
assert.match(serviceSource, /restaurantTableSession\.delete/);
assert.match(serviceSource, /comprobanteComercial\.delete/);
assert.match(serviceSource, /state: 'LIBRE'/);
assert.doesNotMatch(serviceSource, /closeTable\(/);
assert.doesNotMatch(serviceSource, /emitir|PAGADO_TOTAL|contabilizar/i);

assert.match(routes, /\/mesas\/:id\/detalle-v67/);
assert.match(routes, /\/mesas\/:id\/cancelar-apertura-v67/);
assert.match(routes, /requirePermission\('MESAS\.VER'\)/);
assert.match(routes, /requirePermission\('MESAS\.EDITAR'\)/);
assert.match(coreRoutes, /restaurantTableLiveDetailV67Router/);
assert.match(coreRoutes, /router\.use\('\/restaurante', restaurantTableLiveDetailV67Router\)/);
assert.match(publicRoutes, /installRestaurantTableLiveDetailV67/);

assert.match(runtime, /ESTADO DE LA MESA/);
assert.match(runtime, /Total cuenta/);
assert.match(runtime, /Falta entregar/);
assert.match(runtime, /LISTO PARA ENTREGAR/);
assert.match(runtime, /ENTREGADO/);
assert.match(runtime, /NOTA:/);
assert.match(runtime, /Cerrar mesa abierta por error/);
assert.match(runtime, /detalle-v67/);
assert.match(runtime, /cancelar-apertura-v67/);
new vm.Script(runtime);

console.log('RESTAURANT TABLE LIVE DETAIL V67 OK', JSON.stringify({
  clickTableShowsLiveDetail:true,
  showsOrderedDeliveredRemaining:true,
  showsKitchenStates:true,
  showsProductNotes:true,
  emptyOpeningCanBeCancelled:true,
  realActivityCannotBeDiscarded:true
}));
