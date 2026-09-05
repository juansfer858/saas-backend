'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (p) => fs.readFileSync(p, 'utf8');
const guardSource = read('src/modules/edge/edge-tenant-update-guard.js');
const tenantUi = read('src/web/edge-tenant-managed.js');
const tenantPublic = read('src/modules/restaurant/restaurant-edge-managed.public.routes.js');
const platformUi = read('src/web/platform-edge-rollout.js');
const platformPublic = read('src/modules/platform/saas/platform-edge-rollout.public.routes.js');
const platformRoutes = read('src/modules/platform/saas/platform.routes.js');
const platformService = read('src/modules/platform/saas/platform-edge-rollout.service.js');
const coreRoutes = read('src/routes/core.routes.js');
const restaurantPublic = read('src/modules/restaurant/restaurant.public.routes.js');

assert.match(guardSource, /EDGE_UPDATE_PLATFORM_MANAGED/);
assert.match(guardSource, /POST \/releases/);
assert.match(guardSource, /release-channel/);
assert.match(guardSource, /\/deploy/);
assert.match(coreRoutes, /router\.use\('\/edge', edgeTenantUpdateGuard, edgeTenantRouter\)/);

assert.match(tenantUi, /VANTIX_EDGE_TENANT_PLATFORM_MANAGED_V1/);
assert.match(tenantUi, /Publicar release/);
assert.match(tenantUi, /Gestionado por SaaS Master/);
assert.match(tenantUi, /UPDATE_CHECK/);
assert.match(tenantPublic, /X-VantixGC-Edge-Updates/);
assert.match(restaurantPublic, /platformEdgeRolloutPublicRouter/);
assert.match(restaurantPublic, /restaurantEdgeManagedPublicRouter/);

assert.match(platformRoutes, /\/edge\/overview/);
assert.match(platformRoutes, /\/edge\/releases/);
assert.match(platformRoutes, /\/edge\/installations\/.*\/deploy/);
assert.match(platformService, /tenantId: null/);
assert.match(platformService, /EDGE_GLOBAL_ROLLOUT/);
assert.match(platformService, /desiredVersion: release\.version/);
assert.match(platformUi, /Actualizaciones Edge/);
assert.match(platformUi, /Actualizar todos/);
assert.match(platformUi, /Publicar desde Master/);
assert.match(platformPublic, /CENTRAL_ROLLOUT_V1/);

const { edgeTenantUpdateGuard } = require('../src/modules/edge/edge-tenant-update-guard');
function blocked(method, path) {
  let seen;
  edgeTenantUpdateGuard({ method, path }, {}, (error) => { seen = error || null; });
  return seen;
}
assert.equal(blocked('GET', '/installations'), null);
assert.equal(blocked('POST', '/agents'), null);
assert.equal(blocked('POST', '/releases')?.code, 'EDGE_UPDATE_PLATFORM_MANAGED');
assert.equal(blocked('PATCH', '/agents/x/release-channel')?.code, 'EDGE_UPDATE_PLATFORM_MANAGED');
assert.equal(blocked('POST', '/agents/x/deploy')?.code, 'EDGE_UPDATE_PLATFORM_MANAGED');

new Function(platformUi);
new Function(tenantUi);

console.log(JSON.stringify({
  ok: true,
  tenantUpdates: 'PLATFORM_MANAGED_ONLY',
  platformUi: 'CENTRAL_ROLLOUT_V1',
  tenantHardware: 'PRESERVED',
  blockedTenantRoutes: 3
}, null, 2));
