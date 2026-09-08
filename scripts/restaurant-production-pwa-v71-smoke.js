'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('src/modules/restaurant/restaurant-employees.public.routes.js');
const pair = read('src/web/restaurant-production-pair-v63.html');
const kds = read('src/web/restaurant-production-kds-v63.html');
const runtime = read('src/web/restaurant-production-pwa-v71.js');
const sw = read('src/web/restaurant-production-sw-v71.js');
const manifest = JSON.parse(read('src/web/restaurant-production-v63.webmanifest'));
const icon192 = fs.readFileSync(path.join(root, 'src/web/restaurant-production-icon-192.png'));
const icon512 = fs.readFileSync(path.join(root, 'src/web/restaurant-production-icon-512.png'));

new Function(runtime);
new Function(sw);

assert.match(kds, /rel="manifest" href="\/app\/produccion\/manifest\.webmanifest"/);
assert.equal(manifest.id, '/app/produccion');
assert.equal(manifest.start_url, '/app/produccion?pwa=1');
assert.equal(manifest.scope, '/app/produccion');
assert.equal(manifest.display, 'standalone');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
assert.ok(manifest.icons.some((icon) => /maskable/.test(icon.purpose || '')));

assert.match(routes, /restaurant-production-pwa-v71\.js/);
assert.match(routes, /restaurant-production-sw-v71\.js/);
assert.match(routes, /restaurant-production-icon-192\.png/);
assert.match(routes, /restaurant-production-icon-512\.png/);
assert.match(routes, /\/app\/produccion\/pwa-v71\.js/);
assert.match(routes, /\/app\/produccion\/sw\.js/);
assert.match(routes, /Service-Worker-Allowed', '\/app\/produccion'/);
assert.match(routes, /X-VantixGC-Production-PWA', 'v71-installable'/);
assert.match(routes, /apple-mobile-web-app-capable/);

assert.match(runtime, /VANTIX_RESTAURANT_PRODUCTION_PWA_V71/);
assert.match(runtime, /beforeinstallprompt/);
assert.match(runtime, /appinstalled/);
assert.match(runtime, /navigator\.serviceWorker\.register\('\/app\/produccion\/sw\.js'/);
assert.match(runtime, /scope: '\/app\/produccion'/);
assert.match(runtime, /Instalar \$\{roleLabel\(\)\}/);
assert.match(runtime, /COCINA/);
assert.match(runtime, /BARRA/);
assert.match(runtime, /POSTRES/);
assert.match(runtime, /Añadir a pantalla de inicio/);

assert.match(sw, /VANTIX_RESTAURANT_PRODUCTION_PWA_V71/);
assert.match(sw, /vantixgc-production-shell-v71/);
assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
assert.match(sw, /url\.pathname === '\/app\/produccion\/conectar'/);
assert.match(sw, /url\.searchParams\.has\('t'\)/);
assert.match(sw, /pairingTokenCache: false/);
assert.match(sw, /apiCache: false/);
assert.doesNotMatch(sw, /cache\.put\(request.*produccion\/conectar/);

// El mismo QR V63 sigue vinculando de forma permanente y luego abre la PWA.
assert.match(pair, /vantixgc_restaurant_production_device_v63/);
assert.match(pair, /\/api\/public\/restaurante\/produccion-dispositivo\/vincular/);
assert.match(pair, /location\.replace\('\/app\/produccion'\)/);

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
assert.deepEqual(pngDimensions(icon192), { width:192, height:192 });
assert.deepEqual(pngDimensions(icon512), { width:512, height:512 });

console.log('RESTAURANT PRODUCTION PWA V71 SMOKE OK');
console.log(JSON.stringify({
  samePairingQr:true,
  permanentProductionSession:true,
  installButton:true,
  chromiumInstallPrompt:true,
  iosHomeScreenFallback:true,
  standalone:true,
  serviceWorker:true,
  offlineShell:true,
  authenticatedApiCache:false,
  pairingTokenCache:false,
  icons:['192x192','512x512'],
  roles:['COCINA','BARRA','POSTRES']
}, null, 2));
