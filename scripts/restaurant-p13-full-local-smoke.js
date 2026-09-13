'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LAB_MARKER,
  DEFAULT_HOST,
  DEFAULT_PORT,
  REQUIRED_DB_PORT,
  REQUIRED_DB_NAME,
  assertLabConfig
} = require('../lab/restaurant-p13/runtime');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('lab/restaurant-p13/runtime.js');
const compose = read('lab/restaurant-p13/docker-compose.postgres.yml');
const design = read('docs/restaurant-edge-full-runtime-p13.md');
const p12 = read('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js');
const v2Aggregator = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
const edgeWorkspace = read('edge/agent/workspace-entry.js');

assert.equal(LAB_MARKER, 'VANTIX_RESTAURANT_FULL_LOCAL_P13_A');
assert.equal(DEFAULT_HOST, '127.0.0.1');
assert.equal(DEFAULT_PORT, 8790);
assert.equal(REQUIRED_DB_PORT, 55432);
assert.equal(REQUIRED_DB_NAME, 'vantix_p13_lab');

const valid = {
  VANTIX_P13_LAB_ENABLED: 'true',
  P13_HOST: '127.0.0.1',
  P13_PORT: '8790',
  P13_MUTATIONS_ENABLED: 'false',
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://vantix_p13:test@127.0.0.1:55432/vantix_p13_lab'
};
assert.deepEqual(assertLabConfig(valid), {
  host: '127.0.0.1',
  port: 8790,
  dbHost: '127.0.0.1',
  dbPort: 55432,
  dbName: 'vantix_p13_lab'
});

assert.throws(() => assertLabConfig({ ...valid, VANTIX_P13_LAB_ENABLED: 'false' }), /P13 bloqueado/);
assert.throws(() => assertLabConfig({ ...valid, NODE_ENV: 'production' }), /NODE_ENV=production/);
assert.throws(() => assertLabConfig({ ...valid, P13_PORT: '8788' }), /puerto local inválido|reservado/);
assert.throws(() => assertLabConfig({ ...valid, P13_HOST: '0.0.0.0' }), /loopback/);
assert.throws(() => assertLabConfig({ ...valid, P13_MUTATIONS_ENABLED: 'true' }), /solo lectura/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@db.example.com:55432/vantix_p13_lab' }), /base debe ser local/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/vantix_p13_lab' }), /55432/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/saas_backend' }), /vantix_p13_lab/);

// P13-A serves the exact canonical app graph. It must never import or copy the
// simplified Edge workspace as its business UI.
assert.match(runtime, /require\('\.\.\/\.\.\/src\/app'\)/);
assert.doesNotMatch(runtime, /edge\/workspace\/public\/index\.html/);
assert.doesNotMatch(runtime, /WORKSPACE_HTML/);
assert.match(runtime, /P13_A_READ_ONLY/);
assert.match(runtime, /req\.path === '\/api\/v1\/auth\/login'/);
assert.match(runtime, /P13_PUBLIC_QR_HYBRID_UNCHANGED/);
assert.match(runtime, /P13_CONTROL_PLANE_NOT_LOCAL/);
assert.match(runtime, /P13_OUTBOUND_BLOCKED/);

// The existing Edge remains on 8788 and still owns the old emergency workspace;
// P13 only proves that this separate UI will not be the final local runtime.
assert.match(edgeWorkspace, /EDGE_PORT \|\| 8788/);
assert.match(edgeWorkspace, /WORKSPACE_HTML/);
assert.match(design, /Runtime experimental en puerto distinto, inicialmente `8790`/);
assert.match(design, /No modificar los accesos canónicos `8788`/);

// PostgreSQL is hard-bound to loopback and a non-production port/name.
assert.match(compose, /127\.0\.0\.1:55432:5432/);
assert.match(compose, /POSTGRES_DB: vantix_p13_lab/);
assert.match(compose, /POSTGRES_USER: vantix_p13/);

// Canonical Restaurant V2 remains the source of truth for the local runtime.
assert.match(p12, /controlCenter:\s*'\/app\/centro-de-control-v2'/);
assert.match(v2Aggregator, /restaurantV2ControlCenterPublicRouter/);
assert.match(v2Aggregator, /restaurantV2TablesPublicRouter/);
assert.match(v2Aggregator, /restaurantV2OrdersPublicRouter/);
assert.match(v2Aggregator, /restaurantV2CashPublicRouter/);
assert.match(v2Aggregator, /restaurantV2SplitPublicRouter/);
assert.match(v2Aggregator, /restaurantV2KdsPublicRouter/);
assert.match(v2Aggregator, /restaurantV2MenuPublicRouter/);

console.log(JSON.stringify({
  ok: true,
  marker: LAB_MARKER,
  canonicalCoreAppReused: true,
  secondBusinessUiRejected: true,
  labPort: DEFAULT_PORT,
  productionEdgePortUntouched: 8788,
  localPostgresPort: REQUIRED_DB_PORT,
  localDatabase: REQUIRED_DB_NAME,
  businessMutationsLocked: true,
  serverOutboundNetworkBlocked: true,
  publicQrHybridUnchanged: true,
  platformControlPlaneExcluded: true
}));
