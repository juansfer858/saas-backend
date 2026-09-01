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
  const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');

  assert.match(refreshRoutes, /waiter-runtime-v21-account-request/);
  assert.match(refreshRoutes, /waiter-call-v21-account-request/);
  assert.match(refreshRoutes, /v16-autopedido-code-v21-account-request/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/mesero/);
  assert.match(refreshRoutes, /\/app\/centro-de-control\/sw\.js/);
  assert.match(publicRoot, /restaurantWaiterCallRefreshPublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantWaiterCallRefreshPublicRouter\);[\s\S]*router\.use\(restaurantWaiterCallPublicRouter\)/);

  assert.match(callUi, /VantixGCWaiterCallV5/);
  assert.match(callUi, /accountRequestAlerts:true/);
  assert.match(callUi, /TÚ|TU MESA SOLICITA LA CUENTA/);
  assert.match(callUi, /SOLICITA LA CUENTA/);
  assert.match(callUi, /solicitudes-cuenta/);
  assert.match(callUi, /FOREGROUND_SAFETY_SYNC_MS = 5000/);
  assert.match(callUi, /\/api\/public\/restaurante\/mesero-dispositivo\/llamadas/);
  assert.match(callUi, /\/api\/v1\/restaurante\/llamadas-mesero\/stream/);
  assert.doesNotMatch(callUi, /setInterval|MutationObserver/);
  new Function(callUi);

  assert.match(trackingUi, /PEDIR LA CUENTA/);
  assert.match(trackingUi, /CUENTA SOLICITADA/);
  assert.match(trackingUi, /PREPARANDO TU CUENTA/);
  assert.match(trackingUi, /CUENTA EN CAJA/);
  assert.match(trackingUi, /\/pedir-cuenta/);
  assert.match(trackingUi, /VantixGCQrAccountRequestV1/);
  new Function(trackingUi);

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.match(pwa, /<script[^>]+restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v21-account-request[^>]*><\/script>/);
    assert.match(pwa, /<script[^>]+restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request[^>]*><\/script>/);
    assert.match(pwa, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v21-account-request/);
    assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v21-account-request/);
    assert.match(sw, /restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v21-account-request`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
    assert.doesNotMatch(runtime, /VantixGCWaiterCallV5/);

    const callResponse = await fetch(`${baseUrl}/app/restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request`, { cache:'no-store' });
    const callScript = await callResponse.text();
    assert.equal(callResponse.status, 200);
    assert.equal(callResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.match(callScript, /TU MESA TE ESTÁ LLAMANDO/);
    assert.match(callScript, /SOLICITA LA CUENTA/);
    assert.match(callScript, /VantixGCWaiterCallV5/);

    const qrResponse = await fetch(`${baseUrl}/app/restaurant-qr-ui.js?v=account-request-v1`, { cache:'no-store' });
    const qrScript = await qrResponse.text();
    assert.equal(qrResponse.status, 200);
    assert.match(qrScript, /PEDIR LA CUENTA/);
    assert.match(qrScript, /PREPARANDO TU CUENTA/);
    assert.match(qrScript, /VantixGCQrAccountRequestV1/);
  });

  console.log('RESTAURANT WAITER CALL + QR ACCOUNT REQUEST V21 SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
