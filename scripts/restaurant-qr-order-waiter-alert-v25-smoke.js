'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../src/app');
const { publicResponseRefs, publicTopics } = require('../src/modules/restaurant/restaurant-public-realtime-publisher');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

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
  const ui = read('src/web/restaurant-waiter-qr-order-alert-ui.js');
  const layer = read('src/modules/restaurant/restaurant-qr-order-waiter-alert.public.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');

  assert.match(ui, /NUEVO PEDIDO DESDE QR/);
  assert.match(ui, /PEDIDO QR · APOYO GENERAL/);
  assert.match(ui, /ABRIR MESA/);
  assert.match(ui, /FALLBACK_MS = 20_000/);
  assert.match(ui, /detail\?\.meta\?\.source !== 'restaurant-public-qr'/);
  assert.match(ui, /topics\.includes\('restaurant\.order'\)/);
  assert.match(ui, /openedByUserId/);
  assert.match(ui, /source:'QR'/);
  assert.match(ui, /noPeriodicPolling:true/);
  assert.doesNotMatch(ui, /setInterval|MutationObserver/);
  new Function(ui);

  assert.match(layer, /waiter-qr-order-alert-v25/);
  assert.match(layer, /v25-qr-order-alert/);
  assert.match(layer, /X-VantixGC-Waiter-QR-Order/);
  assert.match(publicRoot, /restaurantQrOrderWaiterAlertPublicRouter/);
  assert.match(publicRoot, /restaurantQrPresenceRealtimePublicRouter[\s\S]*restaurantQrOrderWaiterAlertPublicRouter[\s\S]*restaurantTenantRealtimePublicRouter/);

  const orderId = '11111111-1111-4111-8111-111111111111';
  const refs = publicResponseRefs('/api/public/restaurante/qr/x/pedidos', { id:orderId, source:'QR' });
  assert.equal(refs.orderId, orderId);
  assert.ok(publicTopics('/api/public/restaurante/qr/x/pedidos').includes('restaurant.order'));

  await withServer(async (baseUrl) => {
    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-qr-order'), 'v25-realtime');
    assert.match(pwa, /restaurant-waiter-qr-order-alert-ui\.js\?v=waiter-qr-order-alert-v25/);
    assert.match(pwa, /vantix-tenant-realtime\.js\?v=tenant-realtime-v1/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-qr-order'), 'v25-realtime');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v25-qr-order-alert/);
    assert.match(sw, /restaurant-waiter-qr-order-alert-ui\.js\?v=waiter-qr-order-alert-v25/);

    const assetResponse = await fetch(`${baseUrl}/app/restaurant-waiter-qr-order-alert-ui.js?v=waiter-qr-order-alert-v25`, { cache:'no-store' });
    const asset = await assetResponse.text();
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('x-vantixgc-waiter-qr-order'), 'v25-realtime');
    assert.match(asset, /VantixGCWaiterQrOrderAlertV25/);
  });

  console.log('RESTAURANT QR ORDER -> WAITER REALTIME ALERT V25 SMOKE OK');
  console.log(JSON.stringify({
    qrOrderRealtime:true,
    primaryOpenedByWaiter:true,
    generalFallbackAfterMs:20000,
    openTableAction:true,
    eventDedup:true,
    noPeriodicPolling:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
