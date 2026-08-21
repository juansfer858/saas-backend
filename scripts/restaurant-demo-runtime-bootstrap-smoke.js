const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js','utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');

assert.ok(server.includes("require('./scripts/ensure-restaurant-demo-tenant')"));
assert.ok(server.includes('ensureRestaurantDemoTenant()'));
assert.ok(server.includes('ensureRestaurantDemoInBackground'));
assert.ok(server.includes('RESTAURANT_DEMO_RUNTIME_READY'));
assert.ok(server.includes('RESTAURANT_DEMO_RUNTIME_RETRY'));
assert.ok(server.includes('RESTAURANT_DEMO_RUNTIME_FAILED'));
assert.ok(server.includes('RESTAURANT_DEMO_MAX_ATTEMPTS'));
assert.ok(server.includes('DISABLE_RESTAURANT_DEMO_BOOTSTRAP'));
assert.ok(server.indexOf('server = app.listen') < server.indexOf('ensureRestaurantDemoInBackground(1)'), 'HTTP server must start before demo bootstrap begins');
assert.ok(!server.includes('bootstrapRuntime().catch'), 'Demo bootstrap must not be allowed to terminate the Core runtime');
assert.ok(publicRoutes.includes("'/api/public/restaurante/demo-readiness'"));
assert.ok(publicRoutes.includes("subdomain: 'demo-restaurante'"));
assert.ok(publicRoutes.includes('users >= 6'));
assert.ok(publicRoutes.includes('tables >= 6'));
assert.ok(publicRoutes.includes('menuItems >= 4'));
assert.ok(publicRoutes.includes('recipes >= 4'));

console.log('RESTAURANT DEMO NON-BLOCKING RUNTIME BOOTSTRAP SMOKE OK');
