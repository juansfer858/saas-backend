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
  const callUi = read('src/web/restaurant-waiter-call-ui.js');

  assert.match(refreshRoutes, /waiter-runtime-v20-waiter-call-direct/);
  assert.match(refreshRoutes, /waiter-call-v20-direct/);
  assert.match(refreshRoutes, /v16-autopedido-code-v20-waiter-call-direct/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/mesero/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/sw\.js/);
  assert.match(publicRoot, /restaurantWaiterCallRefreshPublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantWaiterCallRefreshPublicRouter\);[\s\S]*router\.use\(restaurantWaiterCallPublicRouter\)/);

  assert.match(callUi, /VantixGCWaiterCallV4/);
  assert.match(callUi, /directDeviceSnapshot:true/);
  assert.match(callUi, /directDeviceAttend:true/);
  assert.match(callUi, /separateScript:true/);
  assert.match(callUi, /FOREGROUND_SAFETY_SYNC_MS = 5000/);
  assert.match(callUi, /\/api\/public\/restaurante\/mesero-dispositivo\/llamadas/);
  assert.match(callUi, /\/api\/v1\/restaurante\/llamadas-mesero\/stream/);
  assert.doesNotMatch(callUi, /setInterval|MutationObserver/);
  new Function(callUi);

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-call'), 'v20-direct-script');
    assert.match(pwa, /<script[^>]+restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v20-waiter-call-direct[^>]*><\/script>/);
    assert.match(pwa, /<script[^>]+restaurant-waiter-call-ui\.js\?v=waiter-call-v20-direct[^>]*><\/script>/);
    assert.match(pwa, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-call'), 'v20-direct-script');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v20-waiter-call-direct/);
    assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v20-waiter-call-direct/);
    assert.match(sw, /restaurant-waiter-call-ui\.js\?v=waiter-call-v20-direct/);
    assert.match(sw, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v20-waiter-call-direct`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-call'), 'v20-direct-script');
    assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
    assert.doesNotMatch(runtime, /VantixGCWaiterCallV4/);

    const callResponse = await fetch(`${baseUrl}/app/restaurant-waiter-call-ui.js?v=waiter-call-v20-direct`, { cache:'no-store' });
    const callScript = await callResponse.text();
    assert.equal(callResponse.status, 200);
    assert.equal(callResponse.headers.get('x-vantixgc-waiter-call'), 'v20-direct-script');
    assert.match(callScript, /TU MESA TE ESTÁ LLAMANDO/);
    assert.match(callScript, /LLAMADO GENERAL · NECESITA ATENCIÓN/);
    assert.match(callScript, /VantixGCWaiterCallV4/);
    assert.match(callScript, /\/api\/public\/restaurante\/mesero-dispositivo\/llamadas/);
  });

  console.log('RESTAURANT WAITER CALL PWA V20 DIRECT SCRIPT SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
