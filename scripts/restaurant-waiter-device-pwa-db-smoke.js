'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { verifyAccessToken } = require('../src/utils/jwt');
const { app } = require('../src/app');
const device = require('../src/modules/restaurant/restaurant-waiter-device.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

async function rejectsCode(promise, code) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `Se esperaba error ${code}`);
  assert.equal(error.code, code);
  return error;
}

async function withHttpServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const address = server.address();
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function getJson(baseUrl, path, session) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache:'no-store',
    headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
  });
  let body = {};
  try { body = await response.json(); } catch {}
  assert.equal(response.status, 200, `${path} debe responder 200: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `${path} debe responder ok=true`);
  return body.data;
}

async function main() {
  const seeded = await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant?.id);
  const [admin, waiter] = await Promise.all([
    prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'ADMIN', activo: true } }),
    prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'MESERO', activo: true } })
  ]);
  assert.ok(admin?.id, 'admin demo faltante');
  assert.ok(waiter?.id, 'mesero demo faltante');

  const pairing = await device.createPairing(tenant.id, admin.id, { userId: waiter.id, deviceName: 'Tablet Stress Mesero 01' });
  assert.ok(pairing.deviceId);
  assert.equal(pairing.reusable, true);
  assert.equal(pairing.multipleDevices, true);
  assert.equal(pairing.expiresAt, null);
  assert.match(pairing.svg, /<svg/);
  const url = new URL(pairing.url);
  const rawToken = url.searchParams.get('t');
  assert.ok(rawToken && rawToken.length >= 20, 'token reutilizable faltante');

  const inspected = await device.inspectPairing(rawToken);
  assert.equal(inspected.deviceId, pairing.deviceId);
  assert.equal(inspected.waiter.id, waiter.id);
  assert.equal(inspected.reusable, true);

  const claimed = await device.claimPairing(rawToken, { deviceName: 'Tablet Stress Mesero 01', userAgent: 'VantixGC-CI/1.0' });
  assert.equal(claimed.deviceId, pairing.deviceId);
  assert.equal(claimed.reusable, true);
  assert.equal(claimed.persistent, true);
  assert.equal(claimed.activatedUntil, null);
  assert.equal(claimed.session.persistent, true);
  assert.equal(claimed.session.subdomain, SUBDOMAIN);
  assert.equal(claimed.session.user.id, waiter.id);
  assert.equal(claimed.session.user.rol, 'MESERO');

  const payload = verifyAccessToken(claimed.session.token);
  assert.equal(payload.userId, waiter.id);
  assert.equal(payload.tenantId, tenant.id);
  assert.equal(payload.rol, 'MESERO');
  assert.equal(payload.deviceId, pairing.deviceId);
  assert.equal(payload.authType, 'WAITER_DEVICE');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'exp'), false, 'el token del dispositivo no debe vencer por fecha');

  const activeRow = await prisma.trackingLink.findUnique({ where:{ id:pairing.deviceId } });
  assert.equal(activeRow.currentStatus, 'ACTIVE');
  assert.equal(activeRow.active, true);
  assert.ok(activeRow.expiresAt.getUTCFullYear() >= 9999, 'la columna legacy expiresAt debe quedar como centinela permanente');

  await withHttpServer(async (baseUrl) => {
    // P12 conserva la URL canónica instalada, pero la resuelve a la PWA V2 sin
    // permitir que el dispositivo vuelva a ejecutar el shell V1.
    const canonicalResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero?view=mesero&pwa=1`, { cache:'no-store', redirect:'manual' });
    assert.equal(canonicalResponse.status, 307, 'la entrada canónica del mesero debe migrar a V2');
    assert.equal(canonicalResponse.headers.get('location'), '/app/centro-de-control/mesero-v2/?view=mesero&pwa=1');
    assert.equal(canonicalResponse.headers.get('x-vantixgc-restaurant-v2-only'), 'p12-v2-only-runtime');
    assert.equal(canonicalResponse.headers.get('x-vantixgc-restaurant-v1-runtime'), 'disabled');

    const pwaResponse = await fetch(`${baseUrl}/app/centro-de-control/mesero-v2/`, { cache:'no-store' });
    const pwaHtml = await pwaResponse.text();
    assert.equal(pwaResponse.status, 200, 'la PWA V2 del mesero debe cargar');
    assert.equal(pwaResponse.headers.get('x-vantixgc-restaurant-v2-device'), 'waiter-p8');
    assert.match(pwaHtml, /data-vantix-device="waiter"/);
    assert.match(pwaHtml, /data-waiter-ui="tablet-3col-v22"/);
    assert.match(pwaHtml, /1 · Mesas/);
    assert.match(pwaHtml, /2 · Carta/);
    assert.match(pwaHtml, /3 · Revisar pedido/);
    assert.doesNotMatch(pwaHtml, /restaurant-ui\.js|restaurant-waiter-runtime-v7\.js|MutationObserver/);

    // El runtime V14 queda congelado para trazabilidad/rollback de código, pero
    // sigue verificándose sintácticamente sin ser la superficie canónica P12.
    const runtimeResponse = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v14`, { cache:'no-store' });
    const runtimeJs = await runtimeResponse.text();
    assert.equal(runtimeResponse.status, 200, 'el runtime Mesero V14 congelado debe permanecer disponible como asset');
    assert.equal(runtimeResponse.headers.get('x-vantixgc-waiter-runtime'), 'v14-review-hard-gate');
    assert.match(runtimeJs, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
    assert.match(runtimeJs, /VANTIX_WAITER_ORDER_REVIEW_SYNC_V13/);
    assert.match(runtimeJs, /VANTIX_WAITER_ORDER_REVIEW_V12/);
    assert.match(runtimeJs, /VANTIX_WAITER_NO_REBOUND_V11/);
    assert.match(runtimeJs, /function applyServiceLocally/);
    assert.match(runtimeJs, /const mutationEpoch = \+\+S\.detailsEpoch/);
    assert.match(runtimeJs, /data-action="remove-person"/);
    assert.match(runtimeJs, /Quitar última persona/);
    assert.match(runtimeJs, /VANTIX_WAITER_DEDICATED_RUNTIME_V7/);
    assert.match(runtimeJs, /queueQtySync/);
    assert.match(runtimeJs, /await flushQtyJobs\(\)/);
    assert.match(runtimeJs, /REVISANDO PEDIDO/);
    assert.match(runtimeJs, /vantix:waiter-order-review-ready/);
    assert.match(runtimeJs, /data-action="confirm-send-draft"/);
    assert.match(runtimeJs, /CONFIRMAR PEDIDO/);
    assert.match(runtimeJs, /orderReviewReadySessionId:null/);
    assert.match(runtimeJs, /hardReviewGate:true/);
    assert.match(runtimeJs, /noDirectKitchenSend:true/);
    assert.doesNotMatch(runtimeJs, /data-action="send-draft"/);
    assert.doesNotMatch(runtimeJs, /if \(action === 'send-draft'\)/);
    assert.match(runtimeJs, /detailsEpoch/);
    assert.doesNotMatch(runtimeJs, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
    assert.doesNotMatch(runtimeJs, /setInterval/);

    const context = await getJson(baseUrl, '/api/v1/restaurante/ui-context', claimed.session);
    assert.equal(context.user.id, waiter.id);
    assert.equal(context.user.baseRol || context.user.rol, 'MESERO');
    assert.equal(context.workAssignment?.mode, 'FLEXIBLE');

    const [zones, tables, menu] = await Promise.all([
      getJson(baseUrl, '/api/v1/restaurante/zonas', claimed.session),
      getJson(baseUrl, '/api/v1/restaurante/mesas', claimed.session),
      getJson(baseUrl, '/api/v1/restaurante/menu', claimed.session)
    ]);
    assert.ok(Array.isArray(zones) && zones.length >= 1);
    assert.ok(Array.isArray(tables) && tables.length >= 1);
    assert.ok(Array.isArray(menu));
  });

  // V11: el QR ya no se consume. Un segundo escaneo crea otra tablet independiente.
  const inspectedAgain = await device.inspectPairing(rawToken);
  assert.equal(inspectedAgain.reusable, true);
  assert.equal(inspectedAgain.waiter.id, waiter.id);
  const secondClaim = await device.claimPairing(rawToken, { deviceName:'Tablet Stress Mesero 02', userAgent:'VantixGC-CI/2.0' });
  assert.notEqual(secondClaim.deviceId, pairing.deviceId);
  assert.equal(secondClaim.reusable, true);
  assert.equal(await device.assertActiveDevice(secondClaim.deviceId, tenant.id, waiter.id), true);

  assert.equal(await device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id), true);
  const listed = await device.listDevices(tenant.id);
  const listedDevice = listed.find((row) => row.id === pairing.deviceId);
  const listedSecond = listed.find((row) => row.id === secondClaim.deviceId);
  assert.ok(listedDevice);
  assert.ok(listedSecond);
  assert.equal(listedDevice.active, true);
  assert.equal(listedSecond.active, true);
  assert.equal(listedDevice.persistent, true);
  assert.equal(listedSecond.persistent, true);
  assert.equal(listedDevice.expiresAt, null);
  assert.equal(listedSecond.expiresAt, null);
  assert.equal(listedDevice.waiter.id, waiter.id);
  assert.equal(listedSecond.waiter.id, waiter.id);

  const beforeThrottle = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId }, select: { lastNotificationAt:true } });
  assert.ok(beforeThrottle?.lastNotificationAt);
  await device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id);
  const afterThrottle = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId }, select: { lastNotificationAt:true } });
  assert.equal(afterThrottle.lastNotificationAt.getTime(), beforeThrottle.lastNotificationAt.getTime());

  const revoked = await device.revokeDevice(tenant.id, admin.id, pairing.deviceId);
  assert.equal(revoked.revoked, true);
  await rejectsCode(device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id), 'RESTAURANT_WAITER_DEVICE_REVOKED');
  assert.equal(await device.assertActiveDevice(secondClaim.deviceId, tenant.id, waiter.id), true, 'revocar Tablet 01 no puede desconectar Tablet 02');

  const row = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId } });
  assert.equal(row.active, false);
  assert.equal(row.currentStatus, 'REVOKED');

  const deviceAudits = await prisma.notificationAudit.findMany({
    where: { tenantId: tenant.id, entity: 'RestaurantWaiterDevice' },
    orderBy: { creadoEn:'asc' }
  });
  const actions = deviceAudits.map((audit) => audit.action);
  assert.ok(actions.includes('WAITER_REUSABLE_PAIRING_CREATED'));
  assert.ok(actions.includes('WAITER_DEVICE_PAIRED_REUSABLE'));
  assert.ok(actions.includes('WAITER_DEVICE_REVOKED'));

  console.log(JSON.stringify({
    ok:true,
    tenant:seeded.subdomain,
    deviceId:pairing.deviceId,
    secondDeviceId:secondClaim.deviceId,
    waiter:waiter.nombre,
    reusablePairing:true,
    multipleDevicesPerWaiter:true,
    independentRevocation:true,
    permanentDeviceAccess:true,
    jwtExpiry:false,
    serverRevocationImmediate:true,
    waiterPwa:'V2_TABLET_3COL_V22_P12_ONLY',
    v1Runtime:false,
    runtimeFrozen:'V11_NO_REBOUND_PLUS_V13_SYNC_PLUS_V14_HARD_GATE',
    orderReviewBeforeSend:true,
    orderSynchronizedBeforeReview:true,
    directKitchenSendImpossibleFromReviewButton:true,
    removePerson:true,
    buttonsDoNotBounceBack:true,
    auditActions:actions
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());