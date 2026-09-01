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

  assert.match(refreshRoutes, /waiter-runtime-v19-waiter-call-device-channel/);
  assert.match(refreshRoutes, /v16-autopedido-code-v19-waiter-call-device-channel/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/mesero/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/sw\.js/);
  assert.match(publicRoot, /restaurantWaiterCallRefreshPublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantWaiterCallRefreshPublicRouter\);[\s\S]*router\.use\(restaurantWaiterCallPublicRouter\)/);

  assert.match(callUi, /VantixGCWaiterCallV3/);
  assert.match(callUi, /initialSnapshot:true/);
  assert.match(callUi, /resumeSafe:true/);
  assert.match(callUi, /ssePrimary:true/);
  assert.match(callUi, /FOREGROUND_SAFETY_SYNC_MS = 5000/);
  assert.match(callUi, /foregroundSafetySnapshotMs:FOREGROUND_SAFETY_SYNC_MS/);
  assert.match(callUi, /fetchSnapshot/);
  assert.match(callUi, /window\.addEventListener\('pageshow', resumeChannel\)/);
  assert.match(callUi, /document\.addEventListener\('visibilitychange'/);
  assert.match(callUi, /window\.addEventListener\('online', resumeChannel\)/);
  assert.match(callUi, /\/api\/v1\/restaurante\/llamadas-mesero'/);
  assert.doesNotMatch(callUi, /setInterval|MutationObserver/);
  new Function(callUi);

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-call'), 'v19-device-channel');
    assert.match(pwa, /<script[^>]+restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v19-waiter-call-device-channel[^>]*><\/script>/);
    assert.match(pwa, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-call'), 'v19-device-channel');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v19-waiter-call-device-channel/);
    assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v19-waiter-call-device-channel/);
    assert.match(sw, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v19-waiter-call-device-channel`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-call'), 'v2-resume-snapshot');
    assert.match(runtime, /TU MESA TE ESTÁ LLAMANDO/);
    assert.match(runtime, /LLAMADO GENERAL · NECESITA ATENCIÓN/);
    assert.match(runtime, /\/llamadas-mesero\/stream/);
    assert.match(runtime, /VantixGCWaiterCallV3/);
    assert.match(runtime, /FOREGROUND_SAFETY_SYNC_MS/);
    assert.match(runtime, /fetchSnapshot/);
  });

  console.log('RESTAURANT WAITER CALL PWA DEVICE CHANNEL SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
