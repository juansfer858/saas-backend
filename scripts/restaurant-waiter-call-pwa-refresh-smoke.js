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
  const realtimeRoutes = read('src/modules/restaurant/restaurant-tenant-realtime.public.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
  const callUi = read('src/web/restaurant-waiter-call-ui.js');
  const paymentUi = read('src/web/restaurant-waiter-electronic-payment-ui.js');
  const qrPaymentUi = read('src/web/restaurant-qr-electronic-payment-ui.js');
  const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');

  // V22 stays in place as compatibility fallback; V23 owns the exact live shell paths first.
  assert.match(refreshRoutes, /waiter-runtime-v22-electronic-payment/);
  assert.match(refreshRoutes, /waiter-call-v21-account-request/);
  assert.match(refreshRoutes, /waiter-electronic-v22/);
  assert.match(realtimeRoutes, /waiter-runtime-v23-tenant-realtime/);
  assert.match(realtimeRoutes, /v23-tenant-realtime/);
  assert.match(realtimeRoutes, /VANTIX_WAITER_TENANT_REALTIME_V23/);
  assert.match(realtimeRoutes, /VANTIX_RESTAURANT_TENANT_REALTIME_V23/);
  assert.match(realtimeRoutes, /\/app\/centro-de-control\/mesero/);
  assert.match(realtimeRoutes, /\/app\/centro-de-control\/sw\.js/);
  assert.match(publicRoot, /restaurantTenantRealtimePublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantPublicRealtimePublisher\);[\s\S]*router\.use\(restaurantTenantRealtimePublicRouter\);[\s\S]*router\.use\(restaurantElectronicPaymentPublicRouter\);[\s\S]*router\.use\(restaurantWaiterCallRefreshPublicRouter\)/);

  assert.match(callUi, /VantixGCWaiterCallV5/);
  assert.match(callUi, /accountRequestAlerts:true/);
  assert.match(callUi, /SOLICITA LA CUENTA/);
  assert.match(callUi, /solicitudes-cuenta/);
  assert.match(callUi, /FOREGROUND_SAFETY_SYNC_MS = 5000/);
  assert.doesNotMatch(callUi, /setInterval|MutationObserver/);
  new Function(callUi);

  assert.match(trackingUi, /PEDIR LA CUENTA/);
  assert.match(trackingUi, /CUENTA SOLICITADA/);
  assert.match(trackingUi, /PREPARANDO TU CUENTA/);
  assert.match(trackingUi, /CUENTA EN CAJA/);
  assert.match(trackingUi, /VantixGCQrAccountRequestV1/);
  new Function(trackingUi);

  assert.match(paymentUi, /PAGO ELECTRÓNICO POR CONFIRMAR/);
  assert.match(paymentUi, /CONFIRMAR PAGO/);
  assert.match(paymentUi, /pagos-electronicos/);
  assert.match(paymentUi, /FALLBACK_MS = 5000/);
  assert.doesNotMatch(paymentUi, /setInterval|MutationObserver/);
  new Function(paymentUi);

  assert.match(qrPaymentUi, /¿Cómo vas a pagar\?/);
  assert.match(qrPaymentUi, /EFECTIVO/);
  assert.match(qrPaymentUi, /PAGO ELECTRÓNICO/);
  assert.match(qrPaymentUi, /YA PAGUÉ · AVISAR AL MESERO/);
  assert.match(qrPaymentUi, /PAGO ELECTRÓNICO CONFIRMADO/);
  assert.doesNotMatch(qrPaymentUi, /setInterval|MutationObserver/);
  new Function(qrPaymentUi);

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-payment'), 'v22-electronic');
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(pwa, /<script[^>]+restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v23-tenant-realtime[^>]*><\/script>/);
    assert.match(pwa, /<script[^>]+restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request[^>]*><\/script>/);
    assert.match(pwa, /<script[^>]+restaurant-waiter-electronic-payment-ui\.js\?v=waiter-electronic-v22[^>]*><\/script>/);
    assert.match(pwa, /<script[^>]+vantix-tenant-realtime\.js\?v=tenant-realtime-v1[^>]*><\/script>/);
    assert.match(pwa, /legacy-runtime-contract:restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v14/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v23-tenant-realtime/);
    assert.match(sw, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v23-tenant-realtime/);
    assert.match(sw, /restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request/);
    assert.match(sw, /restaurant-waiter-electronic-payment-ui\.js\?v=waiter-electronic-v22/);
    assert.match(sw, /vantix-tenant-realtime\.js\?v=tenant-realtime-v1/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v23-tenant-realtime`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
    assert.match(runtime, /VANTIX_WAITER_TENANT_REALTIME_V23/);
    assert.doesNotMatch(runtime, /VantixGCWaiterCallV5/);

    const callResponse = await fetch(`${baseUrl}/app/restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request`, { cache:'no-store' });
    const callScript = await callResponse.text();
    assert.equal(callResponse.status, 200);
    assert.equal(callResponse.headers.get('x-vantixgc-waiter-call'), 'v21-account-request');
    assert.match(callScript, /TU MESA TE ESTÁ LLAMANDO/);
    assert.match(callScript, /SOLICITA LA CUENTA/);
    assert.match(callScript, /VantixGCWaiterCallV5/);

    const paymentResponse = await fetch(`${baseUrl}/app/restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22`, { cache:'no-store' });
    const paymentScript = await paymentResponse.text();
    assert.equal(paymentResponse.status, 200);
    assert.equal(paymentResponse.headers.get('x-vantixgc-waiter-payment'), 'v22-electronic');
    assert.match(paymentScript, /CONFIRMAR PAGO/);

    const qrResponse = await fetch(`${baseUrl}/app/restaurant-qr-ui.js?v=menu-list-v4`, { cache:'no-store' });
    const qrScript = await qrResponse.text();
    assert.equal(qrResponse.status, 200);
    assert.equal(qrResponse.headers.get('x-vantixgc-qr-payment'), 'v22-electronic-confirmed-by-waiter');
    assert.equal(qrResponse.headers.get('x-vantixgc-qr-realtime'), 'v23-tenant');
    assert.match(qrScript, /PEDIR LA CUENTA/);
    assert.match(qrScript, /¿Cómo vas a pagar\?/);
    assert.match(qrScript, /YA PAGUÉ · AVISAR AL MESERO/);
    assert.match(qrScript, /VantixGCQrRealtimeV1/);
  });

  console.log('RESTAURANT WAITER CALL + ACCOUNT REQUEST + ELECTRONIC PAYMENT + TENANT REALTIME V23 SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
