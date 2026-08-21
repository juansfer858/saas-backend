const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const sync = fs.readFileSync('scripts/ensure-restaurant-runtime-schema.js', 'utf8');

assert.ok(server.includes("require('./scripts/ensure-restaurant-runtime-schema')"));
assert.ok(server.includes('await ensureRestaurantRuntimeSchema()'));
assert.ok(sync.includes('RestaurantMenuItem'));
assert.ok(sync.includes("'db', 'push'"));
assert.ok(!sync.includes('accept-data-loss'), 'Runtime schema sync must never bypass Prisma data-loss protection');
assert.ok(sync.includes('to_regclass'));
assert.ok(sync.includes('RESTAURANT_SCHEMA_SYNC_READY'));

console.log('RESTAURANT RUNTIME SCHEMA SYNC SMOKE OK');
