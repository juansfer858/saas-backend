const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');

const seed = fs.readFileSync('scripts/ensure-restaurant-demo-tenant.js','utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js','utf8');
const hash = seed.match(/const PASSWORD_HASH = '([^']+)'/)?.[1];
assert.ok(hash, 'Demo password hash must exist');
assert.equal(bcrypt.compareSync('VantixGC!RestDemo#2026', hash), true, 'Known handoff password must match demo seed');
assert.ok(routes.includes("demoAccessSeed: 'ROTATED_V2_2026_08_21'"));
assert.ok(seed.includes("['ADMIN', 'Administrador Restaurante', 'admin@demo-restaurante.vantixgc.com']"));
assert.ok(seed.includes("['MESERO', 'Mesero Restaurante', 'mesero@demo-restaurante.vantixgc.com']"));
assert.ok(seed.includes("['COCINA', 'Cocina Restaurante', 'cocina@demo-restaurante.vantixgc.com']"));
assert.ok(seed.includes("['BARRA', 'Barra Restaurante', 'barra@demo-restaurante.vantixgc.com']"));
assert.ok(seed.includes("['CAJERO', 'Cajero Restaurante', 'cajero@demo-restaurante.vantixgc.com']"));
console.log('RESTAURANT DEMO HANDOFF CREDENTIALS OK');
