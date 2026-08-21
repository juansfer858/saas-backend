const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js','utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');

assert.ok(server.includes("require('./scripts/ensure-restaurant-demo-tenant')"));
assert.ok(server.includes('await ensureRestaurantDemoTenant()'));
assert.ok(server.includes('RESTAURANT_DEMO_RUNTIME_READY'));
assert.ok(server.includes('DISABLE_RESTAURANT_DEMO_BOOTSTRAP'));
assert.ok(publicRoutes.includes("'/api/public/restaurante/demo-readiness'"));
assert.ok(publicRoutes.includes("subdomain: 'demo-restaurante'"));
assert.ok(publicRoutes.includes('users >= 6'));
assert.ok(publicRoutes.includes('tables >= 6'));
assert.ok(publicRoutes.includes('menuItems >= 4'));
assert.ok(publicRoutes.includes('recipes >= 4'));

console.log('RESTAURANT DEMO RUNTIME BOOTSTRAP SMOKE OK');
