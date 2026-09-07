'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const service = read('src/modules/restaurant/restaurant-qr-direct-test-v54.service.js');
const publicLayer = read('src/modules/restaurant/restaurant-qr-direct-test-v54.public.routes.js');
const composition = read('src/modules/restaurant/restaurant.public.routes.js');
const edgePatch = read('edge/agent/offline-qr-self-order-v54.js');
const edgeBase = read('edge/agent/offline-qr-self-order.js');
const edgeEntry = read('edge/agent/restaurant-entry-v2.js');
const edgeVersion = JSON.parse(read('edge/version.json'));

for (const file of [
  'src/modules/restaurant/restaurant-qr-direct-test-v54.service.js',
  'src/modules/restaurant/restaurant-qr-direct-test-v54.public.routes.js',
  'src/modules/restaurant/restaurant.public.routes.js',
  'edge/agent/offline-qr-self-order-v54.js',
  'edge/agent/restaurant-entry-v2.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

// Cloud: no PIN is requested by V54, but a per-phone visit token is still created
// so table state, traceability, seat attribution and existing order rate limits survive.
assert.match(service, /RESTAURANT_QR_DIRECT_TEST_V54/);
assert.match(service, /authorizeDirectVisit/);
assert.match(service, /restaurantQrVisitDevice\.create/);
assert.match(service, /RESTAURANT_QR_TABLE_NOT_OPEN/);
assert.match(service, /RESTAURANT_ACCOUNT_ALREADY_PREPARED/);
assert.doesNotMatch(service, /safeCodeEqual|visitCode\(/);

assert.match(publicLayer, /VANTIX_RESTAURANT_QR_DIRECT_TEST_V54/);
assert.match(publicLayer, /\/autorizar-directo/);
assert.match(publicLayer, /localStorage\.setItem\(storageKey,body\.data\.visitToken\)/);
assert.match(publicLayer, /isOrder/);
assert.match(publicLayer, /directAuthorize/);
assert.match(publicLayer, /pinRequired:false/);
assert.match(publicLayer, /#waiterVisitCodeV32\{display:none!important\}/);

assert.match(composition, /restaurantQrDirectTestV54PublicRouter/);
assert.match(composition, /installRestaurantQrDirectTestV54/);
assert.ok(
  composition.indexOf('router.use(restaurantQrDirectTestV54PublicRouter)') < composition.indexOf('router.use(restaurantVisitPublicRouter)'),
  'V54 debe interceptar antes de la ruta QR protegida original'
);

// Reversible: the original 4-digit implementation remains untouched in source.
assert.match(edgeBase, /El código debe tener 4 dígitos/);
assert.match(edgeBase, /safeEqual\(session\.visitCode, code\)/);
assert.match(edgePatch, /VANTIX_EDGE_QR_DIRECT_TEST_V54/);
assert.match(edgePatch, /false && !safeEqual\(session\.visitCode, code\)/);
assert.match(edgePatch, /autopedido directo no depende del PIN sincronizado/);
assert.match(edgePatch, /\/autorizar/);
assert.match(edgeEntry, /require\('\.\/offline-qr-self-order-v54'\)/);
assert.doesNotMatch(edgeEntry, /require\('\.\/offline-qr-self-order'\);/);
assert.equal(edgeVersion.version, '2.1.12-qr-direct-test.1');
assert.equal(edgeVersion.channel, 'PILOT');

console.log('RESTAURANT QR DIRECT TEST V54 CLOUD + EDGE OK');
