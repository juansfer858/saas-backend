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
  const presenceRoutes = read('src/modules/restaurant/restaurant-qr-presence-realtime.public.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
  const p12 = read('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js');
  const v2Waiter = read('src/web/restaurant-v2-waiter-p8.html');
  const v2Sw = read('src/web/restaurant-v2-waiter-sw-p8.js');
  const callUi = read('src/web/restaurant-waiter-call-ui.js');
  const paymentUi = read('src/web/restaurant-waiter-electronic-payment-ui.js');
  const qrOrderAlertUi = read('src/web/restaurant-waiter-qr-order-alert-ui.js');
  const qrPaymentUi = read('src/web/restaurant-qr-electronic-payment-ui.js');
  const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');
  const qrRealtimeUi = read('src/web/restaurant-qr-realtime-ui.js');

  // Las capas probadas de llamados/pagos siguen siendo módulos independientes. P12
  // las carga dentro del shell Mesero V2 en vez de volver al shell V1.
  assert.match(refreshRoutes, /waiter-call-v21-account-request/);
  assert.match(refreshRoutes, /waiter-electronic-v22/);
  assert.match(realtimeRoutes, /VANTIX_WAITER_TENANT_REALTIME_V23/);
  assert.match(presenceRoutes, /VANTIX_QR_TABLE_PRESENCE_V24/);
  assert.match(publicRoot, /restaurantQrPresenceRealtimePublicRouter/);
  assert.match(publicRoot, /restaurantTenantRealtimePublicRouter/);
  assert.match(p12, /\/app\/centro-de-control\/mesero/);
  assert.match(p12, /X-VantixGC-Restaurant-V1-Runtime/);

  for (const asset of [
    'restaurant-waiter-call-ui.js?v=waiter-call-v21-account-request',
    'restaurant-waiter-electronic-payment-ui.js?v=waiter-electronic-v22',
    'restaurant-waiter-qr-order-alert-ui.js?v=waiter-qr-order-alert-v25'
  ]) {
    assert.ok(v2Waiter.includes(asset), `Mesero V2 debe cargar ${asset}`);
    assert.ok(v2Sw.includes(asset), `SW Mesero V2 debe precargar ${asset}`);
  }
  assert.match(v2Waiter, /data-waiter-ui="tablet-3col-v22"/);
  assert.match(v2Waiter, /restaurant-v2-device-realtime-p8\.js/);
  assert.match(v2Sw, /waiterCalls:true/);
  assert.match(v2Sw, /accountRequests:true/);
  assert.match(v2Sw, /electronicPaymentConfirmation:true/);
  assert.match(v2Sw, /qrOrderAlerts:true/);

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

  assert.match(qrOrderAlertUi, /NUEVO PEDIDO DESDE QR/);
  assert.match(qrOrderAlertUi, /VantixGCWaiterQrOrderAlertV25/);
  assert.match(qrOrderAlertUi, /restaurant\.order/);
  assert.doesNotMatch(qrOrderAlertUi, /setInterval|MutationObserver/);
  new Function(qrOrderAlertUi);

  assert.match(qrPaymentUi, /¿Cómo vas a pagar\?/);
  assert.match(qrPaymentUi, /EFECTIVO/);
  assert.match(qrPaymentUi, /PAGO ELECTRÓNICO/);
  assert.match(qrPaymentUi, /YA PAGUÉ · AVISAR AL MESERO/);
  assert.match(qrPaymentUi, /PAGO ELECTRÓNICO CONFIRMADO/);
  assert.doesNotMatch(qrPaymentUi, /setInterval|MutationObserver/);
  new Function(qrPaymentUi);

  assert.match(qrRealtimeUi, /visita\/realtime/);
  assert.match(qrRealtimeUi, /tablePresenceBeforeAuthorization:true/);
  assert.match(qrRealtimeUi, /automaticOpenClose:true/);
  assert.doesNotMatch(qrRealtimeUi, /setInterval|MutationObserver/);
  new Function(qrRealtimeUi);

  await withServer(async (baseUrl) => {
    const canonical = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store', redirect:'manual' });
    assert.equal(canonical.status, 307);
    assert.equal(canonical.headers.get('location'), '/app/centro-de-control/mesero-v2/?view=mesero&pwa=1');
    assert.equal(canonical.headers.get('x-vantixgc-restaurant-v2-only'), 'p12-v2-only-runtime');
    assert.equal(canonical.headers.get('x-vantixgc-restaurant-v1-runtime'), 'disabled');

    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero-v2/`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-restaurant-v2-device'), 'waiter-p8');
    assert.match(pwa, /data-waiter-ui="tablet-3col-v22"/);
    assert.match(pwa, /restaurant-v2-device-realtime-p8\.js/);
    assert.match(pwa, /restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request/);
    assert.match(pwa, /restaurant-waiter-electronic-payment-ui\.js\?v=waiter-electronic-v22/);
    assert.match(pwa, /restaurant-waiter-qr-order-alert-ui\.js\?v=waiter-qr-order-alert-v25/);
    assert.doesNotMatch(pwa, /restaurant-waiter-runtime-v7\.js|restaurant-ui\.js/);

    const oldSwResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const oldSw = await oldSwResponse.text();
    assert.equal(oldSwResponse.status, 200);
    assert.equal(oldSwResponse.headers.get('x-vantixgc-restaurant-v1-runtime'), 'disabled');
    assert.match(oldSw, /VANTIX_RESTAURANT_V1_SW_RETIREMENT_P12/);

    const v2SwResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero-v2/sw.js`, { cache:'no-store' });
    const v2SwHttp = await v2SwResponse.text();
    assert.equal(v2SwResponse.status, 200);
    assert.equal(v2SwResponse.headers.get('service-worker-allowed'), '/app/centro-de-control/mesero-v2/');
    assert.match(v2SwHttp, /VANTIX_RESTAURANT_WAITER_TABLET_3COL_V22/);
    assert.match(v2SwHttp, /restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request/);
    assert.match(v2SwHttp, /restaurant-waiter-electronic-payment-ui\.js\?v=waiter-electronic-v22/);
    assert.match(v2SwHttp, /restaurant-waiter-qr-order-alert-ui\.js\?v=waiter-qr-order-alert-v25/);

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

    const qrAlertResponse = await fetch(`${baseUrl}/app/restaurant-waiter-qr-order-alert-ui.js?v=waiter-qr-order-alert-v25`, { cache:'no-store' });
    const qrAlertScript = await qrAlertResponse.text();
    assert.equal(qrAlertResponse.status, 200);
    assert.match(qrAlertScript, /NUEVO PEDIDO DESDE QR/);
    assert.match(qrAlertScript, /VantixGCWaiterQrOrderAlertV25/);

    const qrResponse = await fetch(`${baseUrl}/app/restaurant-qr-ui.js?v=menu-list-v4`, { cache:'no-store' });
    const qrScript = await qrResponse.text();
    assert.equal(qrResponse.status, 200);
    assert.equal(qrResponse.headers.get('x-vantixgc-qr-payment'), 'v22-electronic-confirmed-by-waiter');
    assert.equal(qrResponse.headers.get('x-vantixgc-qr-realtime'), 'v24-table-presence');
    assert.match(qrScript, /PEDIR LA CUENTA/);
    assert.match(qrScript, /¿Cómo vas a pagar\?/);
    assert.match(qrScript, /YA PAGUÉ · AVISAR AL MESERO/);
    assert.match(qrScript, /VANTIX_QR_TABLE_PRESENCE_V24/);
    assert.match(qrScript, /vantix:restaurant-table-availability/);
    assert.match(qrScript, /VantixGCQrRealtimeV1/);
  });

  console.log('RESTAURANT MESERO V2 P12 + LLAMADOS + CUENTA + PAGO ELECTRONICO + QR ORDER ALERT SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
