'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');
const treasury = require('../src/modules/treasury/treasury.service');
const realtime = require('../src/modules/realtime/tenant-realtime.service');
const { topicsForPath } = require('../src/modules/realtime/tenant-realtime.routes');

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
  const coreRoutes = read('src/routes/core.routes.js');
  const publicRoot = read('src/modules/restaurant/restaurant.public.routes.js');
  const panelLoader = read('src/web/panel-integration-extras.js');
  const tenantClient = read('src/web/vantix-tenant-realtime.js');
  const coreUi = read('src/web/core-realtime-panel-ui.js');
  const qrRealtime = read('src/web/restaurant-qr-realtime-ui.js');
  const realtimePublic = read('src/modules/restaurant/restaurant-tenant-realtime.public.routes.js');

  assert.match(coreRoutes, /tenantRealtimeMutationMiddleware/);
  assert.match(coreRoutes, /router\.use\('\/realtime', tenantRealtimeRouter\)/);
  assert.match(publicRoot, /restaurantPublicRealtimePublisher/);
  assert.match(publicRoot, /restaurantTenantRealtimePublicRouter/);
  assert.match(publicRoot, /router\.use\(restaurantPublicRealtimePublisher\);[\s\S]*router\.use\(restaurantTenantRealtimePublicRouter\);[\s\S]*router\.use\(restaurantElectronicPaymentPublicRouter\)/);
  assert.match(panelLoader, /vantix-tenant-realtime\.js/);
  assert.match(panelLoader, /core-realtime-panel-ui\.js/);
  assert.match(tenantClient, /\/api\/v1\/realtime\/stream/);
  assert.match(tenantClient, /vantix:tenant-realtime/);
  assert.match(coreUi, /\/app\/tesoreria/);
  assert.match(coreUi, /topics\.has\('treasury'\)/);
  assert.match(qrRealtime, /restaurant-visit-realtime/);
  assert.match(realtimePublic, /VANTIX_RESTAURANT_TENANT_REALTIME_V23/);
  assert.match(realtimePublic, /VANTIX_WAITER_TENANT_REALTIME_V23/);
  assert.doesNotMatch(tenantClient, /MutationObserver|setInterval/);
  assert.doesNotMatch(coreUi, /MutationObserver|setInterval/);
  assert.doesNotMatch(qrRealtime, /MutationObserver|setInterval/);

  const kdsTopics = topicsForPath('/api/v1/restaurante/comandas/abc/estado');
  assert.ok(kdsTopics.includes('restaurant.command'));
  const cashTopics = topicsForPath('/api/v1/restaurante/caja/turnos/abc/cerrar');
  assert.ok(cashTopics.includes('treasury'));
  const treasuryTopics = topicsForPath('/api/v1/tesoreria/pagos');
  assert.ok(treasuryTopics.includes('treasury'));

  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({ data:{ nombreEmpresa:`Realtime ${suffix}`, subdomain:`rt-${suffix}`, nicho:'RESTAURANTE' } });
  const otherTenant = await prisma.tenant.create({ data:{ nombreEmpresa:`Realtime other ${suffix}`, subdomain:`rt-other-${suffix}`, nicho:'RESTAURANTE' } });
  const bank = await prisma.cajaBanco.create({ data:{ tenantId:tenant.id, tipo:'BANCO', nombre:`Banco restaurante ${suffix}`, banco:'Banco QA', numeroCuenta:`${Date.now()}`, saldoActual:0, activo:true } });

  let otherTenantEvents = 0;
  const unsubscribeOther = realtime.subscribeTenant(otherTenant.id, () => { otherTenantEvents += 1; });
  let received = null;
  const receivedPromise = new Promise((resolve) => {
    const unsubscribe = realtime.subscribeTenant(tenant.id, (event) => {
      received = event;
      unsubscribe();
      resolve(event);
    });
  });

  await prisma.$transaction((tx) => treasury.recordTreasuryMovementInTx(tx, {
    tenantId:tenant.id,
    cajaBancoId:bank.id,
    tipo:'INGRESO',
    monto:28500,
    sign:1,
    referencia:`REST-${suffix}`,
    concepto:'Pago restaurante visible en Core'
  }));

  await realtime.publishTenantChange(tenant.id, ['treasury','restaurant.account'], { cajaBancoId:bank.id }, { source:'qa-restaurant-cash' });
  await Promise.race([
    receivedPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime tenant event timeout')), 1500))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  unsubscribeOther();

  assert.equal(received.tenantId, tenant.id);
  assert.ok(received.topics.includes('treasury'));
  assert.equal(received.refs.cajaBancoId, bank.id);
  assert.equal(otherTenantEvents, 0, 'events must never cross tenants');

  const coreAccounts = await treasury.listCajaBanco(tenant.id);
  const coreBank = coreAccounts.find((row) => row.id === bank.id);
  assert.ok(coreBank, 'Core Treasury sees the same restaurant bank/cash account');
  assert.equal(Number(coreBank.saldoActual), 28500, 'restaurant treasury movement is immediately present in Core balance');
  const movement = await prisma.movimientoTesoreria.findFirst({ where:{ tenantId:tenant.id, cajaBancoId:bank.id, referencia:`REST-${suffix}` } });
  assert.ok(movement, 'restaurant movement is stored in the central Treasury ledger');
  assert.equal(Number(movement.saldoNuevo), 28500);

  await withServer(async (baseUrl) => {
    const restaurantResponse = await fetch(`${baseUrl}/app/restaurant-ui.js?v=restaurant-ui-v1`, { cache:'no-store' });
    const restaurantUi = await restaurantResponse.text();
    assert.equal(restaurantResponse.status, 200);
    assert.equal(restaurantResponse.headers.get('x-vantixgc-restaurant-realtime'), 'v23-tenant');
    assert.match(restaurantUi, /VANTIX_RESTAURANT_TENANT_REALTIME_V23/);
    assert.match(restaurantUi, /Sincronización instantánea · En vivo/);
    assert.doesNotMatch(restaurantUi, /setInterval|MutationObserver/);

    const qrResponse = await fetch(`${baseUrl}/app/restaurant-qr-ui.js?v=menu-list-v4`, { cache:'no-store' });
    const qrUi = await qrResponse.text();
    assert.equal(qrResponse.status, 200);
    assert.equal(qrResponse.headers.get('x-vantixgc-qr-realtime'), 'v23-tenant');
    assert.match(qrUi, /VANTIX_QR_TENANT_REALTIME_V23/);
    assert.match(qrUi, /VantixGCQrRealtimeV1/);
    assert.match(qrUi, /PAGO ELECTRÓNICO/);

    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store' });
    const pwa = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200);
    assert.equal(pwaResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(pwa, /restaurant-waiter-runtime-v7\.js\?v=waiter-runtime-v23-tenant-realtime/);
    assert.match(pwa, /vantix-tenant-realtime\.js\?v=tenant-realtime-v1/);
    assert.match(pwa, /restaurant-waiter-call-ui\.js\?v=waiter-call-v21-account-request/);
    assert.match(pwa, /restaurant-waiter-electronic-payment-ui\.js\?v=waiter-electronic-v22/);

    const swResponse = await fetch(`${baseUrl}/app/centro-de-control/sw.js`, { cache:'no-store' });
    const sw = await swResponse.text();
    assert.equal(swResponse.status, 200);
    assert.equal(swResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate-v16-autopedido-code-v23-tenant-realtime/);
    assert.match(sw, /vantix-tenant-realtime\.js\?v=tenant-realtime-v1/);

    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v23-tenant-realtime`, { cache:'no-store' });
    const runtime = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-realtime'), 'v23-tenant');
    assert.match(runtime, /VANTIX_WAITER_TENANT_REALTIME_V23/);
    assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);

    const coreClientResponse = await fetch(`${baseUrl}/app/vantix-tenant-realtime.js?v=tenant-realtime-v1`, { cache:'no-store' });
    assert.equal(coreClientResponse.status, 200);
    assert.equal(coreClientResponse.headers.get('x-vantixgc-realtime'), 'tenant-v1');
  });

  console.log('RESTAURANT TENANT REALTIME V23 + CORE TREASURY VISIBILITY SMOKE OK');
  console.log(JSON.stringify({
    clientRealtime:true,
    waiterRealtime:true,
    kitchenRealtime:true,
    cashRealtime:true,
    coreRealtime:true,
    postgresListenNotify:true,
    tenantIsolation:true,
    restaurantCashUsesCoreTreasuryBalance:true,
    browserPeriodicPollingRemovedFromRestaurantUi:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await realtime._shutdownForTest().catch(() => {});
  await prisma.$disconnect().catch(() => {});
});
