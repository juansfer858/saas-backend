'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../src/app');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const refreshRoutes = read('src/modules/restaurant/restaurant-waiter-call-refresh.public.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');

  assert.match(refreshRoutes, /waiter-runtime-v17-waiter-call/);
  assert.match(refreshRoutes, /v16-autopedido-code-v17-waiter-call/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/mesero/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/sw\.js/);
  assert.match(publicRoot, /restaurantWaiterCallRefreshPublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantWaiterCallRefreshPublicRouter\);[\s\S]*router\.use\(restaurantWaiterCallPublicRouter\)/);

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-call'), 'v17-refresh');
    assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v17-waiter-call/);
    assert.doesNotMatch(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-call'), 'v17-refresh');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v17-waiter-call/);
    assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v17-waiter-call/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v17-waiter-call`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-call'), 'v1-escalation');
    assert.match(runtime, /TU MESA TE ESTÁ LLAMANDO/);
    assert.match(runtime, /LLAMADO GENERAL · NECESITA ATENCIÓN/);
    assert.match(runtime, /\/llamadas-mesero\/stream/);
  });

  console.log('RESTAURANT WAITER CALL PWA REFRESH SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
