'use strict';

const assert = require('node:assert/strict');
const { assertRestaurantP14RuntimeConfig } = require('../lab/restaurant-p14/runtime-config');
const {
  LOCAL_RESTAURANT_ENTRY,
  LOCAL_LOGIN_MARKER,
  RUNTIME_PHASE,
  tenantHeader,
  isReadOnlyMethod,
  isCentralSuperCoreUiPath,
  mutationBoundaryForRequest,
  isAllowedOutboundTarget,
  localLoginHtml,
  installPilotBoundary
} = require('../lab/restaurant-p14/runtime');

const baseEnv = Object.freeze({
  RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'true',
  P14_RUNTIME_ENABLED: 'true',
  P14_TENANT_SUBDOMAIN: 'demo-restaurante',
  P14_INSTALLATION_ID: 'HOME-PILOT-01',
  P14_RELEASE_CHANNEL: 'PILOT',
  P14_OPERATIONAL_MODE: 'LOCAL_FIRST',
  P14_HTTP_PORT: '8790',
  P14_LAN_ENABLED: 'true',
  P14_BIND_HOST: '0.0.0.0',
  P14_ADVERTISE_HOST: '192.168.1.50',
  P14_LAN_CIDR: '192.168.1.0/24',
  DATABASE_URL: 'postgresql://vantix_p14:test-only@127.0.0.1:55432/vantix_p14_home_pilot',
  P14_JWT_SECRET: 'p14-test-only-jwt-secret-longer-than-32-characters',
  P14_ADMIN_PASSWORD: 'P14-Test-Only-Password',
  P14_CORE_URL: 'https://core.vantixgc.com',
  P14_SYNC_ENABLED: 'false'
});

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function runBoundary(middleware, request) {
  const response = responseRecorder();
  let nextCalls = 0;
  middleware({
    method: request.method || 'GET',
    path: request.path || '/',
    headers: request.headers || {}
  }, response, () => { nextCalls += 1; });
  return { response, nextCalls };
}

function main() {
  const config = assertRestaurantP14RuntimeConfig({ ...baseEnv });

  assert.equal(RUNTIME_PHASE, 'P14-1A');
  assert.equal(LOCAL_RESTAURANT_ENTRY, '/app/centro-de-control-v2');
  assert.equal(tenantHeader({ headers: { 'x-tenant-subdomain': ' DEMO-RESTAURANTE ' } }), 'demo-restaurante');
  assert.equal(tenantHeader({ headers: {} }), '');

  assert.equal(isReadOnlyMethod('GET'), true);
  assert.equal(isReadOnlyMethod('head'), true);
  assert.equal(isReadOnlyMethod('OPTIONS'), true);
  assert.equal(isReadOnlyMethod('POST'), false);

  assert.equal(isCentralSuperCoreUiPath('/app/dashboard'), true);
  assert.equal(isCentralSuperCoreUiPath('/app/contabilidad/libro'), true);
  assert.equal(isCentralSuperCoreUiPath('/app/centro-de-control-v2'), false);
  assert.equal(isCentralSuperCoreUiPath('/app/restaurante-v2/mesas'), false);

  assert.equal(mutationBoundaryForRequest('POST', '/api/v1/auth/login'), 'AUTH_LOGIN');
  assert.equal(mutationBoundaryForRequest('POST', '/api/v1/restaurante/v2/caja/turno/abrir'), null);
  assert.equal(mutationBoundaryForRequest('PATCH', '/api/v1/restaurante/v2/kds/comandas/1'), null);

  assert.equal(isAllowedOutboundTarget('http://127.0.0.1:8790/__p14/status', config), true);
  assert.equal(isAllowedOutboundTarget('http://localhost:55432', config), true);
  assert.equal(isAllowedOutboundTarget('https://core.vantixgc.com/api/v1/edge/sync', config), false);
  assert.equal(isAllowedOutboundTarget('https://example.com', config), false);
  assert.equal(isAllowedOutboundTarget('not-a-url', config), false);
  assert.equal(isAllowedOutboundTarget(
    'https://core.vantixgc.com/api/v1/edge/sync',
    { ...config, core: { ...config.core, syncEnabled: true } }
  ), true);

  const html = localLoginHtml(config);
  assert.match(html, new RegExp(LOCAL_LOGIN_MARKER));
  assert.match(html, /P14 · piloto local-first aislado/);
  assert.match(html, /demo-restaurante/);
  assert.match(html, /HOME-PILOT-01/);
  assert.match(html, /192\.168\.1\.50:8790/);
  assert.match(html, /admin@demo-restaurante\.vantixgc\.com/);
  assert.doesNotMatch(html, /p14-test-only-jwt-secret/);
  assert.doesNotMatch(html, /P14-Test-Only-Password/);

  const boundary = installPilotBoundary(config);

  let result = runBoundary(boundary, {
    method: 'GET',
    path: '/app/restaurante-v2/mesas',
    headers: { 'x-tenant-subdomain': 'demo-restaurante' }
  });
  assert.equal(result.nextCalls, 1);
  assert.equal(result.response.headers['x-vantixgc-p14-phase'], 'P14-1A');
  assert.equal(result.response.headers['x-vantixgc-p14-installation'], 'HOME-PILOT-01');

  result = runBoundary(boundary, {
    method: 'GET',
    path: '/app/restaurante-v2/mesas',
    headers: { 'x-tenant-subdomain': 'demo-core' }
  });
  assert.equal(result.nextCalls, 0);
  assert.equal(result.response.statusCode, 403);
  assert.equal(result.response.body.code, 'P14_TENANT_LOCK_MISMATCH');

  result = runBoundary(boundary, { method: 'GET', path: '/platform/saas' });
  assert.equal(result.response.statusCode, 404);
  assert.equal(result.response.body.code, 'P14_CONTROL_PLANE_CLOUD_ONLY');

  result = runBoundary(boundary, { method: 'GET', path: '/app/contabilidad' });
  assert.equal(result.response.statusCode, 404);
  assert.equal(result.response.body.code, 'P14_SUPER_CORE_UI_CLOUD_ONLY');

  result = runBoundary(boundary, { method: 'GET', path: '/r/demo-restaurante/mesa-1' });
  assert.equal(result.response.statusCode, 409);
  assert.equal(result.response.body.code, 'P14_PUBLIC_QR_CORE_ONLY');

  result = runBoundary(boundary, { method: 'POST', path: '/api/v1/auth/login' });
  assert.equal(result.response.statusCode, 400);
  assert.equal(result.response.body.code, 'P14_TENANT_HEADER_REQUIRED');

  result = runBoundary(boundary, {
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: { 'x-tenant-subdomain': 'demo-restaurante' }
  });
  assert.equal(result.nextCalls, 1);
  assert.equal(result.response.headers['x-vantixgc-p14-mutation-boundary'], 'AUTH_LOGIN');

  result = runBoundary(boundary, {
    method: 'POST',
    path: '/api/v1/restaurante/v2/caja/turno/abrir',
    headers: { 'x-tenant-subdomain': 'demo-restaurante' }
  });
  assert.equal(result.nextCalls, 0);
  assert.equal(result.response.statusCode, 423);
  assert.equal(result.response.body.code, 'P14_OPERATIONAL_MUTATIONS_LOCKED');

  console.log('P14_CANONICAL_RUNTIME_SHELL_OK');
}

main();
