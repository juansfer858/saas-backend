'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const service = read('src/modules/restaurant/restaurant-waiter-device.service.js');
const tenantRoutes = read('src/modules/restaurant/restaurant-waiter-device.routes.js');
const publicRoutes = read('src/modules/restaurant/restaurant-waiter-device.public.routes.js');
const employeePublicRoutes = read('src/modules/restaurant/restaurant-employee-work.public.routes.js');
const auth = read('src/middleware/auth-middleware.js');
const jwt = read('src/utils/jwt.js');
const coreRoutes = read('src/routes/core.routes.js');
const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
const theme = read('src/web/restaurant-theme.js');
const admin = read('src/web/restaurant-waiter-device-admin.js');
const pair = read('src/web/restaurant-waiter-pair.html');
const pwa = read('src/web/restaurant-waiter-pwa.html');
const performance = read('src/web/restaurant-waiter-performance-v6.js');
const restaurantUi = read('src/web/restaurant-ui.js');
const manifest = JSON.parse(read('src/web/restaurant-waiter-manifest.webmanifest'));
const sw = read('src/web/restaurant-waiter-sw.js');
const restaurantService = read('src/modules/restaurant/restaurant.service.js');
const zoneService = read('src/modules/restaurant/restaurant-zones.service.js');

assert.match(service, /RESTAURANT_WAITER_DEVICE/);
assert.match(service, /PAIRING_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
assert.match(service, /updateMany\([\s\S]*currentStatus:\s*'PAIRING'/, 'el claim debe ser atómico y de un solo uso');
assert.match(service, /tokenHash:\s*hashToken\(consumeNonce\)/, 'el token de emparejamiento debe invalidarse tras usarlo');
assert.match(service, /authType:\s*'WAITER_DEVICE'/);
assert.match(service, /expiresIn:\s*'365d'/);
assert.match(service, /LAST_SEEN_WRITE_INTERVAL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/, 'último uso no debe escribirse por cada request');
assert.match(service, /rol:\s*'MESERO'/, 'sólo un usuario MESERO puede recibir un dispositivo');

assert.match(tenantRoutes, /\/dispositivos-mesero/);
assert.match(tenantRoutes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(tenantRoutes, /router\.delete\('\/dispositivos-mesero\/:id'/);
assert.match(publicRoutes, /\/api\/public\/restaurante\/mesero-dispositivo\/vincular/);
assert.match(publicRoutes, /\/app\/centro-de-control\/conectar/);
assert.match(publicRoutes, /\/app\/centro-de-control\/mesero/);
assert.match(publicRoutes, /\/app\/restaurant-waiter-ui-v6\.js/);
assert.match(publicRoutes, /manifest\.webmanifest/);
assert.match(publicRoutes, /Service-Worker-Allowed/);
assert.match(publicRoutes, /waiter-icon-192\.png/);
assert.match(publicRoutes, /waiter-icon-512\.png/);
assert.match(publicRoutes, /WAITER_PWA_ENGINE_V6/);
assert.match(publicRoutes, /restaurant-waiter-performance-v6\.js\?v=waiter-perf-v6/);
assert.match(publicRoutes, /restaurant-waiter-ui-v6\.js\?v=waiter-full-v6/);
assert.match(publicRoutes, /X-VantixGC-Waiter-UI', 'v6-serialized/);
assert.match(publicRoutes, /X-VantixGC-Waiter-PWA', 'v6-fast-stable/);
assert.match(publicRoutes, /waiterStableBase\(base\)/);
assert.match(publicRoutes, /Este dispositivo no quedó vinculado/);
assert.match(publicRoutes, /No se pudo abrir Mesero/);
assert.match(publicRoutes, /firstOperationalView/);
assert.match(publicRoutes, /setTimeout\(\(\)=>meseroTab\.click\(\),0\)/, 'la PWA debe esperar la primera vista antes de forzar Mesero');
assert.match(coreRoutes, /restaurantWaiterDeviceRouter/);
assert.match(publicRoot, /restaurantWaiterDevicePublicRouter/);

assert.match(employeePublicRoutes, /VANTIX_WAITER_RENDER_SERIAL_V6/);
assert.match(employeePublicRoutes, /waiterRenderPromise/);
assert.match(employeePublicRoutes, /waiterRenderQueued/);
assert.match(employeePublicRoutes, /waiterStableBase/);
const employeePublicModule = require('../src/modules/restaurant/restaurant-employee-work.public.routes');
const transformedUi = employeePublicModule.waiterStableBase(restaurantUi);
assert.match(transformedUi, /VANTIX_WAITER_RENDER_SERIAL_V6/);
assert.match(transformedUi, /waiterRenderPromise = \(async \(\) =>/);
assert.match(transformedUi, /queueMicrotask\(\(\) => renderWaiter/);
new Function(transformedUi);

assert.match(performance, /VANTIX_WAITER_INTERACTION_STABILITY_V6/);
assert.match(performance, /responseCache/);
assert.match(performance, /inflight/);
assert.match(performance, /\/api\/v1\/restaurante\/zonas/);
assert.match(performance, /\/api\/v1\/restaurante\/menu/);
assert.match(performance, /pedido-borrador/);
assert.match(performance, /data-waiter-mutation-busy/);
assert.match(performance, /Actualizando…/);
assert.match(performance, /stopImmediatePropagation/);
new Function(performance);

assert.match(jwt, /deviceId\s*=\s*null/);
assert.match(jwt, /authType\s*=\s*null/);
assert.match(auth, /payload\.authType\s*===\s*'WAITER_DEVICE'/);
assert.match(auth, /assertActiveDevice/);
assert.match(auth, /user\.rol\s*!==\s*'MESERO'/);

assert.match(theme, /location\.pathname\.startsWith\('\/app\/centro-de-control'\)/);
assert.match(theme, /location\.pathname\s*!==\s*'\/app\/centro-de-control'/);
assert.match(theme, /restaurant-waiter-device-admin\.js/);
assert.match(admin, /Conectar tablet o celular/);
assert.match(admin, /\/api\/v1\/usuarios/);
assert.match(admin, /\/api\/v1\/restaurante\/dispositivos-mesero\/vinculo/);
assert.match(admin, /Desautorizar/);
assert.match(admin, /rol\s*===\s*'MESERO'/);
assert.match(admin, /normalizePrimaryCenterAction/);
assert.match(admin, /\[data-cc-tab=\"estado\"\]/);
assert.match(admin, /button\.dataset\.ccTab\s*=\s*'mesero'/);
assert.match(admin, /button\.textContent\s*=\s*'👤 Mesero'/);
assert.match(admin, /if \(!isAdmin\) return;/, 'conectar dispositivos debe seguir restringido a administración');

assert.match(restaurantService, /applyWaiterTableVisibility/);
assert.match(restaurantService, /assignedWaiterId:\s*null/);
assert.match(restaurantService, /table\.assignedWaiterId\s*&&\s*table\.assignedWaiterId\s*!==\s*user\.id/);
assert.match(zoneService, /assignedWaiterId:\s*null/);
assert.match(zoneService, /assignedWaiterId:\s*user\.id/);

assert.equal(manifest.name, 'VantixGC Mesero');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.orientation, 'any');
assert.equal(manifest.start_url, '/app/centro-de-control/mesero?view=mesero&pwa=1');
assert.equal(manifest.scope, '/app/centro-de-control');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
assert.ok(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '192x192' && /waiter-icon-192\.png$/.test(icon.src)), 'manifest debe incluir icono PNG 192x192');
assert.ok(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '512x512' && /waiter-icon-512\.png$/.test(icon.src)), 'manifest debe incluir icono PNG 512x512');
assert.ok(fs.statSync(path.join(__dirname, '..', 'src/web/restaurant-waiter-icon-192.png')).size > 100, 'PNG 192 faltante o vacío');
assert.ok(fs.statSync(path.join(__dirname, '..', 'src/web/restaurant-waiter-icon-512.png')).size > 100, 'PNG 512 faltante o vacío');

assert.match(pair, /beforeinstallprompt/);
assert.match(pair, /Añadir a pantalla de inicio/);
assert.match(pair, /Vincular este dispositivo/);
assert.match(pair, /\/app\/centro-de-control\/mesero\?view=mesero&pwa=1/);
assert.match(pair, /localStorage\.setItem\(SESSION_KEY/);
assert.match(pair, /meta name="referrer" content="no-referrer"/);

assert.match(pwa, /<title>VantixGC Mesero<\/title>/);
assert.match(pwa, /restaurant-ui\.js\?v=waiter-full-v4/, 'el HTML base conserva un placeholder estable; la ruta pública lo reemplaza por V6');
assert.match(pwa, /waiter-user-badge/);
assert.doesNotMatch(pwa, /restaurant-control-center\.js/, 'la PWA dedicada no debe reescribir su ruta mediante el shell administrativo');
assert.match(pwa, /@media\(min-width:1000px\)/);
assert.match(pwa, /@media\(max-width:999px\)/);
assert.match(pwa, /@media\(max-width:599px\)/);
assert.match(pwa, /VER PEDIDO/);
assert.match(pwa, /MutationObserver/);
assert.match(pwa, /100dvh/);

assert.match(sw, /vantixgc-waiter-shell-v6/);
assert.match(sw, /restaurant-waiter-performance-v6\.js\?v=waiter-perf-v6/);
assert.match(sw, /restaurant-waiter-ui-v6\.js\?v=waiter-full-v6/);
assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return/);
assert.match(sw, /request\.method !== 'GET'/);
assert.match(sw, /centro-de-control\/mesero/);
assert.doesNotMatch(sw, /POST|PUT|PATCH|DELETE/, 'service worker no debe reintentar ni cachear mutaciones');

console.log(JSON.stringify({
  ok: true,
  product: 'VantixGC Mesero PWA',
  pairing: 'single-use-10m',
  deviceSession: 'server-revocable',
  targetRole: 'MESERO',
  centerPrimaryAction: 'Mesero',
  sharedTablePool: true,
  explicitOtherWaiterIsolation: true,
  fullPanelAsset: 'restaurant-waiter-ui-v6',
  serviceWorkerCache: 'vantixgc-waiter-shell-v6',
  blankScreenRecovery: true,
  delayedMeseroActivation: true,
  serializedRender: true,
  requestDeduplication: true,
  shortLivedReadCache: true,
  mutationBusyGuard: true,
  dedicatedWaiterUiRoute: true,
  themeRemovedFromPrimaryGrid: true,
  icons: ['192x192-png', '512x512-png', 'svg'],
  layouts: ['tablet-landscape', 'tablet-portrait', 'mobile', 'desktop'],
  businessMutationReplay: false
}));
