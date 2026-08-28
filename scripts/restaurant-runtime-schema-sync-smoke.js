const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const sync = fs.readFileSync('scripts/ensure-restaurant-runtime-schema.js', 'utf8');

assert.ok(server.includes("require('./scripts/ensure-restaurant-runtime-schema')"));
assert.ok(server.includes('await ensureRestaurantRuntimeSchema()'));
assert.ok(server.includes('ensureRestaurantSchemaBeforeListen'));
assert.ok(server.includes('RESTAURANT_SCHEMA_STARTUP_READY'));
assert.ok(server.includes('CORE_STARTUP_FAILED'));

const schemaGate = server.indexOf('await ensureRestaurantSchemaBeforeListen()');
const listen = server.indexOf("server = app.listen(PORT, '0.0.0.0'");
const demoStart = server.indexOf('restaurantDemoTimer = setTimeout(() => ensureRestaurantDemoInBackground(1), 0)');
assert.ok(schemaGate >= 0 && listen >= 0 && schemaGate < listen, 'Restaurant schema must be ready before the Core accepts HTTP traffic');
assert.ok(demoStart > listen, 'Demo bootstrap must remain non-blocking after HTTP startup');

const demoFunctionStart = server.indexOf('async function ensureRestaurantDemoInBackground');
const runtimeStart = server.indexOf('async function startRuntime');
const demoFunction = server.slice(demoFunctionStart, runtimeStart);
assert.ok(!demoFunction.includes('ensureRestaurantRuntimeSchema'), 'Schema readiness must not depend on demo bootstrap');

assert.ok(sync.includes('RestaurantMenuItem'));
assert.ok(sync.includes('RestaurantQrVisitDevice'));
assert.ok(sync.includes("'db', 'push'"));
assert.ok(!sync.includes('accept-data-loss'), 'Runtime schema sync must never bypass Prisma data-loss protection');
assert.ok(sync.includes('to_regclass'));
assert.ok(sync.includes('RESTAURANT_SCHEMA_SYNC_READY'));

console.log('RESTAURANT RUNTIME SCHEMA STARTUP GATE SMOKE OK');
