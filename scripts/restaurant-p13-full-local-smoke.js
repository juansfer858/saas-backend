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
  LOCAL_RESTAURANT_ENTRY,
  CENTRAL_SUPER_CORE_UI_PREFIXES,
  assertLabConfig,
  isCentralSuperCoreUiPath,
  mutationBoundaryForRequest
} = require('../lab/restaurant-p13/runtime');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('lab/restaurant-p13/runtime.js');
const bootstrap = read('lab/restaurant-p13/bootstrap-demo.js');
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
assert.equal(LOCAL_RESTAURANT_ENTRY, '/app/centro-de-control-v2');
assert.ok(CENTRAL_SUPER_CORE_UI_PREFIXES.includes('/app/dashboard'));
assert.equal(isCentralSuperCoreUiPath('/app/dashboard'), true);
assert.equal(isCentralSuperCoreUiPath('/app/contabilidad'), true);
assert.equal(isCentralSuperCoreUiPath('/app/restaurante-v2/caja'), false);
assert.equal(isCentralSuperCoreUiPath('/app/centro-de-control-v2'), false);

const valid = {
  VANTIX_P13_LAB_ENABLED: 'true',
  P13_HOST: '127.0.0.1',
  P13_PORT: '8790',
  P13_MUTATIONS_ENABLED: 'false',
  P13_TENANT_SUBDOMAIN: 'demo-restaurante',
  P13_JWT_SECRET: 'p13-test-secret-that-is-longer-than-thirty-two-characters',
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://vantix_p13:test@127.0.0.1:55432/vantix_p13_lab'
};
assert.deepEqual(assertLabConfig(valid), {
  host: '127.0.0.1',
  port: 8790,
  tenantSubdomain: 'demo-restaurante',
  jwtSecret: valid.P13_JWT_SECRET,
  dbHost: '127.0.0.1',
  dbPort: 55432,
  dbName: 'vantix_p13_lab'
});

assert.throws(() => assertLabConfig({ ...valid, VANTIX_P13_LAB_ENABLED: 'false' }), /P13 bloqueado/);
assert.throws(() => assertLabConfig({ ...valid, NODE_ENV: 'production' }), /NODE_ENV=production/);
assert.throws(() => assertLabConfig({ ...valid, P13_PORT: '8788' }), /puerto local inválido|reservado/);
assert.throws(() => assertLabConfig({ ...valid, P13_HOST: '0.0.0.0' }), /loopback/);
assert.throws(() => assertLabConfig({ ...valid, P13_MUTATIONS_ENABLED: 'true' }), /debe permanecer false/);
assert.throws(() => assertLabConfig({ ...valid, P13_TENANT_SUBDOMAIN: '' }), /P13_TENANT_SUBDOMAIN/);
assert.throws(() => assertLabConfig({ ...valid, P13_JWT_SECRET: 'short' }), /P13_JWT_SECRET/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@db.example.com:55432/vantix_p13_lab' }), /base debe ser local/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/vantix_p13_lab' }), /55432/);
assert.throws(() => assertLabConfig({ ...valid, DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/saas_backend' }), /vantix_p13_lab/);

// P13 reuses the canonical application graph as an engine, but exposes only
// the restaurant control-center surface locally. Super Core UI remains cloud-only.
assert.match(runtime, /require\('\.\.\/\.\.\/src\/app'\)/);
assert.doesNotMatch(runtime, /edge\/workspace\/public\/index\.html/);
assert.doesNotMatch(runtime, /WORKSPACE_HTML/);
assert.match(runtime, /RESTAURANT_CONTROL_CENTER_ONLY/);
assert.match(runtime, /LOCAL_RESTAURANT_ENTRY/);
assert.match(runtime, /P13_SUPER_CORE_UI_CLOUD_ONLY/);
assert.match(runtime, /P13_BOUNDARY_LOCKED/);
assert.match(runtime, /P13_PUBLIC_QR_CORE_ONLY/);
assert.match(runtime, /publicQrPolicy: 'CORE_CLOUD_ONLY'/);
assert.match(runtime, /P13_CONTROL_PLANE_NOT_LOCAL/);
assert.match(runtime, /P13_OUTBOUND_BLOCKED/);
assert.match(runtime, /P13_TENANT_LOCK_MISMATCH/);
assert.match(runtime, /process\.env\.JWT_SECRET = config\.jwtSecret/);

// E1-E4 open only explicitly approved restaurant operational mutations.
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/auth/login'), 'AUTH_LOGIN');
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/usuarios'), 'IDENTITY_USERS');
assert.equal(mutationBoundaryForRequest('PATCH', '/api/v1/usuarios/user-1'), 'IDENTITY_USERS');
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/seguridad/roles'), 'IDENTITY_RBAC');
assert.equal(mutationBoundaryForRequest('PUT', '/api/v1/seguridad/roles/role-1/permisos'), 'IDENTITY_RBAC');
assert.equal(mutationBoundaryForRequest('PUT', '/api/v1/seguridad/usuarios/user-1/roles'), 'IDENTITY_RBAC');
assert.equal(mutationBoundaryForRequest('PUT', '/api/v1/seguridad/usuarios/user-1/permisos'), 'IDENTITY_RBAC');
assert.equal(mutationBoundaryForRequest('PATCH', '/api/v1/restaurante/v2/kds/comandas/cmd-1'), 'RESTAURANT_KDS_COMMAND_STATE');
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/terceros'), null);
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/restaurante/pedidos'), null);
assert.equal(mutationBoundaryForRequest('POST', '/api/v1/comercial/ventas'), null);

// B1 creates only a disposable local demo tenant. Credentials are supplied by env,
// hashed with bcrypt and never printed or committed.
assert.match(bootstrap, /assertLabConfig\(process\.env\)/);
assert.match(bootstrap, /config\.tenantSubdomain !== 'demo-restaurante'/);
assert.match(bootstrap, /P13_ADMIN_PASSWORD/);
assert.match(bootstrap, /bcrypt\.hash\(adminPassword, 12\)/);
assert.match(bootstrap, /ensureRestaurantDemoTenant/);
assert.match(bootstrap, /tenants\.length !== 1/);
assert.doesNotMatch(bootstrap, /core\.vantixgc\.com/);

// The existing Edge remains on 8788 and still owns the old emergency workspace;
// P13 remains an isolated runtime until the Windows pilot is ready.
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
  canonicalCoreAppReusedAsEngine: true,
  localSurface: 'RESTAURANT_CONTROL_CENTER_ONLY',
  localEntry: LOCAL_RESTAURANT_ENTRY,
  superCoreUi: 'CLOUD_ONLY',
  labPort: DEFAULT_PORT,
  productionEdgePortUntouched: 8788,
  localPostgresPort: REQUIRED_DB_PORT,
  localDatabase: REQUIRED_DB_NAME,
  tenantLock: 'demo-restaurante',
  labJwtIsolated: true,
  localAdminPasswordHashed: true,
  allOtherBusinessMutationsLocked: true,
  serverOutboundNetworkBlocked: true,
  publicQrPolicy: 'CORE_CLOUD_ONLY',
  platformControlPlaneExcluded: true
}));