'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const service = read('src/modules/edge/edge-workspace.service.js');
const bridge = read('src/modules/edge/edge-hybrid-local-origin-v53.routes.js');
const coreRoutes = read('src/routes/core.routes.js');
const publicModulePath = path.join(root, 'src/modules/restaurant/restaurant-hybrid-local-origin-v53.public.routes.js');
const publicModuleSource = read('src/modules/restaurant/restaurant-hybrid-local-origin-v53.public.routes.js');
const publicComposition = read('src/modules/restaurant/restaurant.public.routes.js');

for (const file of [
  'src/modules/edge/edge-workspace.service.js',
  'src/modules/edge/edge-hybrid-local-origin-v53.routes.js',
  'src/modules/restaurant/restaurant-hybrid-local-origin-v53.public.routes.js',
  'src/routes/core.routes.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file} no compila: ${result.stderr}`);
}

assert.match(service, /function safeLocalOrigin\(installation, requestedOrigin\)/);
assert.match(service, /requestedPort !== Number\(installation\.lanPort\)/);
assert.match(service, /String\(installation\.lanHost/);
assert.match(service, /'127\.0\.0\.1'/);
assert.match(service, /'localhost'/);
assert.match(service, /'::1'/);
assert.match(service, /safeLocalOrigin\(installation, options\.returnOrigin\)/);
assert.match(bridge, /req\.body\?\.returnOrigin/);
assert.match(bridge, /createLocalAccessGrant\(req\.tenantId, req\.user, req\.params\.id, \{ returnOrigin \}\)/);
assert.match(coreRoutes, /edgeHybridLocalOriginV53Router/);
assert.ok(coreRoutes.indexOf("router.use('/edge', edgeHybridLocalOriginV53Router)") < coreRoutes.indexOf("router.use('/edge', edgeTenantUpdateGuard, edgeTenantRouter)"));
assert.match(publicComposition, /installRestaurantHybridLocalOriginV53/);
assert.match(publicModuleSource, /VANTIX_RESTAURANT_HYBRID_LOCAL_ORIGIN_V53/);
assert.match(publicModuleSource, /params\.get\('return'\)/);
assert.match(publicModuleSource, /returnOrigin/);
assert.match(publicModuleSource, /local-access-grant/);

const { hybridLocalOriginRuntimeV53 } = require(publicModulePath);
const calls = [];
const context = {
  URL,
  URLSearchParams,
  location: {
    search: '?edge=edge-1&return=http%3A%2F%2F127.0.0.1%3A8788',
    origin: 'https://core.vantixgc.com'
  },
  window: {
    fetch: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return { ok: true };
    }
  }
};
vm.createContext(context);
vm.runInContext(hybridLocalOriginRuntimeV53, context);

(async () => {
  await context.window.fetch('/api/v1/edge/agents/edge-1/local-access-grant', {
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
    body: '{}'
  });
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.returnOrigin, 'http://127.0.0.1:8788');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test');

  await context.window.fetch('/api/v1/restaurante/mesas', { method: 'GET' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input, '/api/v1/restaurante/mesas');

  console.log('RESTAURANT HYBRID LOCAL ORIGIN V53 OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
