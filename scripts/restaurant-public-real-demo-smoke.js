'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const access = read('src/modules/restaurant/restaurant-public-demo-access.public.routes.js');
const guard = read('src/middleware/restaurant-public-demo-guard.js');
const installer = read('src/modules/public-installer/public-installer.routes.js');
const core = read('src/routes/core.routes.js');
const demo = read('src/web/restaurant-public-demo.html');

assert.match(access, /DEMO_SUBDOMAIN = 'demo-restaurante'/);
assert.match(access, /DEMO_ADMIN_EMAIL = 'admin@demo-restaurante\.vantixgc\.com'/);
assert.match(access, /DEMO_AUTH_TYPE = 'PUBLIC_RESTAURANT_DEMO'/);
assert.match(access, /expiresIn: '45m'/);
assert.match(access, /demoMode: 'PUBLIC_REAL_V2'/);
assert.match(access, /router\.get\('\/demo-session'/);

assert.match(installer, /restaurantPublicDemoAccessRouter/);
assert.ok(
  installer.indexOf("router.use('/api/public/restaurantes', restaurantPublicDemoAccessRouter)") <
  installer.indexOf("router.use('/api/public/restaurantes', restaurantSelfServicePublicRouter)"),
  'Demo access router must be mounted before self-service router'
);
assert.match(installer, /router\.get\('\/restaurantes\/demo'/);

assert.match(core, /restaurantPublicDemoGuard/);
assert.ok(core.indexOf('router.use(authMiddleware)') < core.indexOf('router.use(restaurantPublicDemoGuard)'));
assert.ok(core.indexOf('router.use(restaurantPublicDemoGuard)') < core.indexOf('router.use(enforceTenantPermissions)'));

assert.match(guard, /PUBLIC_RESTAURANT_DEMO/);
assert.match(guard, /RESTAURANT_PUBLIC_DEMO_WRITE_BLOCKED/);
assert.match(guard, /\/api\\\/v1\\\/restaurante\\\/v2\\\/(?:mesas\|sesiones\|caja\|division\|kds)/);
assert.match(guard, /v2\/caja\/recibo\/imprimir/);

assert.match(demo, /MODO DEMOSTRACIÓN/);
assert.match(demo, /\/api\/public\/restaurantes\/demo-session/);
assert.match(demo, /vantixgc_public_demo_session_backup_v1/);
assert.match(demo, /restoreSession/);
assert.match(demo, /frame\.src='\/app\/centro-de-control-v2'/);
assert.doesNotMatch(demo, /const state=\{view:'dashboard'/);
assert.doesNotMatch(demo, /Ventas demo/);

console.log('RESTAURANT PUBLIC REAL DEMO SMOKE OK');
