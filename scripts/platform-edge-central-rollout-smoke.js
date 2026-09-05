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
const edgeRoutes = read('src/modules/edge/edge.routes.js');
const edgeArtifactProxy = read('src/modules/edge/edge-release-proxy.public.routes.js');
const edgeReleaseWorkflow = read('.github/workflows/edge-release-publish.yml');
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
assert.match(platformRoutes, /\/edge\/installations\/.*\/cancel-deployment/);
assert.match(platformService, /tenantId: null/);
assert.match(platformService, /EDGE_GLOBAL_ROLLOUT/);
assert.match(platformService, /desiredVersion: release\.version/);
assert.match(platformService, /action: 'UPDATE_CHECK'/);
assert.match(platformService, /PLATFORM_EDGE_DEPLOY_NOW/);
assert.match(platformService, /updateCheckId/);
assert.match(platformService, /edgeRelayRequest\.findMany/);
assert.match(platformService, /cancelActiveDeployment/);
assert.match(platformService, /state: 'CANCELED'/);
assert.match(platformService, /desiredVersion: null, updaterState: 'IDLE'/);
assert.match(platformService, /EDGE_DEPLOYMENT_CANCEL/);

assert.match(edgeRoutes, /edgeReleaseProxyPublicRouter/);
assert.match(edgeRoutes, /proxyArtifactUrl/);
assert.match(edgeRoutes, /delivery = 'CORE_PROXY_V1'/);
assert.ok(edgeRoutes.indexOf('publicRouter.use(edgeReleaseProxyPublicRouter)') < edgeRoutes.indexOf('publicRouter.use(edgeAuth)'), 'artifact distribution must be reachable by the legacy updater before Edge auth');
assert.match(edgeArtifactProxy, /CORE_LOCAL_V2/);
assert.match(edgeArtifactProxy, /CORE_PROXY_V1/);
assert.match(edgeArtifactProxy, /LOCAL_ARTIFACT_ROOT/);
assert.match(edgeArtifactProxy, /public\/edge-releases/);
assert.match(edgeArtifactProxy, /resolveLocalArtifact/);
assert.match(edgeArtifactProxy, /sha256File/);
assert.match(edgeArtifactProxy, /EDGE_ARTIFACT_LOCAL_HASH_MISMATCH/);
assert.match(edgeArtifactProxy, /EDGE_ARTIFACT_SIGNATURE_INVALID/);
assert.match(edgeArtifactProxy, /ALLOWED_ARTIFACT_HOSTS/);
assert.match(edgeArtifactProxy, /github\.com/);
assert.match(edgeArtifactProxy, /Readable\.fromWeb/);
assert.match(edgeArtifactProxy, /edgeDeployment\.findUnique/);
assert.match(edgeArtifactProxy, /edgeRelease\.findUnique/);
assert.ok(edgeArtifactProxy.indexOf('resolveLocalArtifact(release)') < edgeArtifactProxy.indexOf('resolveUpstream(release)'), 'Core-local artifact must be preferred before GitHub fallback');
assert.match(edgeReleaseWorkflow, /Bundle validated Edge ZIP into Core release store/);
assert.match(edgeReleaseWorkflow, /public\/edge-releases/);
assert.match(edgeReleaseWorkflow, /vantixgc-edge-core-artifacts-v1/);
assert.match(edgeReleaseWorkflow, /git push origin/);

assert.match(platformUi, /Actualizaciones Edge/);
assert.match(platformUi, /Actualizar todos/);
assert.match(platformUi, /Publicar desde Master/);
assert.match(platformUi, /Cancelar despliegue/);
assert.match(platformUi, /updateCheckMarkup/);
assert.match(platformUi, /Auto-update desactivado en este Edge/);
assert.match(platformUi, /scheduleEdgePoll/);
assert.match(platformUi, /3000/);
assert.match(platformUi, /data-cancel-deployment/);
assert.match(platformUi, /cancel-deployment/);
assert.match(platformPublic, /CENTRAL_ROLLOUT_V4_UPDATE_CHECK/);
assert.match(platformPublic, /platform-edge-central-v4-update-check/);

// The Platform Edge surface must be self-contained. A failure in the legacy panel
// globals must never collapse the central rollout view into a tiny flash message.
assert.match(platformUi, /function platformApi\(/);
assert.match(platformUi, /function renderLoading\(/);
assert.match(platformUi, /function renderError\(/);
assert.match(platformUi, /No se pudo abrir Actualizaciones Edge/);
assert.match(platformUi, /data-edge-view/);
assert.doesNotMatch(platformUi, /window\.api\(/);
assert.doesNotMatch(platformUi, /window\.esc\(/);

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
  platformUi: 'CENTRAL_ROLLOUT_V4_UPDATE_CHECK',
  deployNowRelay: true,
  deploymentAutoRefresh: true,
  edgeArtifactDelivery: 'CORE_LOCAL_PREFERRED_V2',
  directGithubDependencyRemovedFromCriticalPath: true,
  futureReleaseBundling: 'AUTOMATIC_PR_COMMIT',
  stuckDeploymentRecovery: true,
  tenantHardware: 'PRESERVED',
  blockedTenantRoutes: 3
}, null, 2));
