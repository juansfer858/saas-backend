const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const registry = require('../src/modules/platform/verticals/vertical-registry');
const edgeRegistry = require('../edge/runtime/vertical-registry');

const restaurant = registry.getVertical('RESTAURANT');
const lithography = registry.getVertical('LITHOGRAPHY');
const pets = registry.getVertical('PETS');

assert.ok(restaurant, 'RESTAURANT debe existir');
assert.equal(restaurant.state, 'AVAILABLE');
assert.equal(restaurant.edgeAdapter, 'restaurant');
assert.equal(restaurant.edgeWorkspace, 'restaurant');
assert.equal(restaurant.localFirst, true);
assert.equal(lithography?.state, 'RESERVED');
assert.equal(pets?.state, 'RESERVED');
assert.equal(registry.getVertical('CORE'), null, 'CORE no puede registrarse como vertical');

const manifest = {
  core: { code: 'CORE', runtime: 'EDGE_UNIVERSAL_V1' },
  verticals: [{ code: 'RESTAURANT', localFirst: true }]
};
const chosen = edgeRegistry.primaryAdapter(manifest);
assert.equal(chosen.adapter.code, 'RESTAURANT');
assert.equal(edgeRegistry.operationRoute('RESTAURANT_ORDER_CREATE', manifest).endpoint, '/edge/api/v1/sync/restaurant-operations');
assert.equal(edgeRegistry.operationRoute('GENERIC_SALE', manifest).endpoint, '/edge/api/v1/sync/operations');
assert.equal(edgeRegistry.primaryAdapter({ core: { code: 'CORE' }, verticals: [] }), null);

for (const file of [
  'src/modules/platform/verticals/vertical-registry.js',
  'src/modules/platform/verticals/vertical-entitlement.service.js',
  'edge/runtime/vertical-registry.js',
  'edge/agent/universal-entry.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

const routes = read('src/modules/edge/edge.routes.js');
const provisioning = read('src/modules/platform/saas/platform-tenant-provisioning.service.js');
const platformRoutes = read('src/modules/platform/saas/platform.routes.js');
const supervisor = read('edge/supervisor/supervisor.js');
const selfHeal = read('scripts/ensure-edge-runtime-schema.js');
const schema = read('prisma/tenant-vertical-entitlements-v1.prisma');
const entitlementService = read('src/modules/platform/verticals/vertical-entitlement.service.js');

assert.match(schema, /model TenantVerticalEntitlement/);
assert.match(schema, /@@unique\(\[tenantId, verticalCode\]\)/);
assert.match(provisioning, /verticalEntitlements/);
assert.match(provisioning, /verticalCode:\s*'RESTAURANT'/);
assert.match(routes, /vertical-manifest/);
assert.match(routes, /hasVertical\(req\.edgeAgent\.tenantId, 'RESTAURANT'\)/);
assert.match(routes, /hasVertical\(req\.tenantId, 'RESTAURANT'\)/);
assert.match(platformRoutes, /adminRouter\.get\('\/verticals'/);
assert.match(platformRoutes, /tenants\/:tenantId\/verticals/);
assert.match(platformRoutes, /verticals\/:verticalCode/);
assert.match(entitlementService, /setFromPlatform/);
assert.match(entitlementService, /edgeManifest/);
assert.match(supervisor, /universal-entry\.js/);
assert.match(selfHeal, /TenantVerticalEntitlement/);
assert.doesNotMatch(read('src/modules/platform/verticals/vertical-registry.js'), /code:\s*['"]CORE['"]/);

console.log('UNIVERSAL VERTICAL REGISTRY V1 STATIC SMOKE OK');
