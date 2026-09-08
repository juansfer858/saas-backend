const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v74 = require('../src/modules/restaurant/restaurant-waiter-close-empty-v74.public.routes');
const liveDetail = require('../src/modules/restaurant/restaurant-table-live-detail-v67.service');

assert.equal(v74.MARKER, 'VANTIX_WAITER_CLOSE_EMPTY_OPENING_V74');
assert.match(v74.waiterCloseEmptyV74Runtime, /Cerrar mesa abierta por error/);
assert.match(v74.waiterCloseEmptyV74Runtime, /\/detalle-v67/);
assert.match(v74.waiterCloseEmptyV74Runtime, /\/cancelar-apertura-v67/);
assert.match(v74.waiterCloseEmptyV74Runtime, /canCancelOpening !== true/);
assert.match(v74.waiterCloseEmptyV74Runtime, /location\.reload\(\)/);

assert.equal(liveDetail.canCancelForUser({ rol:'MESERO', id:'mesero-1' }, { openedByUserId:'mesero-1' }), true);
assert.equal(liveDetail.canCancelForUser({ rol:'MESERO', id:'mesero-2' }, { openedByUserId:'mesero-1' }), false);
assert.equal(liveDetail.canCancelForUser({ rol:'ADMIN', id:'admin-1' }, { openedByUserId:'mesero-1' }), true);
assert.equal(liveDetail.canCancelForUser({ rol:'MESERO', id:'mesero-1' }, { openedByUserId:null }), false);

const serviceSource = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-table-live-detail-v67.service.js'), 'utf8');
assert.match(serviceSource, /RESTAURANT_TABLE_OPENING_NOT_OWNER/);
assert.match(serviceSource, /hasItems \|\| hasSentOrder \|\| hasCommands/);
assert.match(serviceSource, /payments > 0 \|\| fiscalDocuments > 0 \|\| activeQrDevices > 0/);
assert.match(serviceSource, /sale\.estado !== 'BORRADOR'/);
assert.match(serviceSource, /numeric\(sale\.total\) !== 0/);

const routesSource = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-table-live-detail-v67.routes.js'), 'utf8');
assert.match(routesSource, /cancelar-apertura-v67/);
assert.match(routesSource, /requirePermission\('MESAS\.EDITAR'\)/);

const publicRoutes = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant.public.routes.js'), 'utf8');
const installPos = publicRoutes.indexOf('router.use(installRestaurantWaiterCloseEmptyV74)');
const waiterPos = publicRoutes.indexOf('router.use(restaurantWaiterDevicePublicRouter)');
assert.ok(installPos >= 0 && waiterPos >= 0 && installPos < waiterPos, 'V74 debe envolver el runtime antes del router de dispositivo Mesero');

console.log('RESTAURANT WAITER CLOSE EMPTY V74 SMOKE OK');
