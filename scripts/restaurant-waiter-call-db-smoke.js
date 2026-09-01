'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');
const calls = require('../src/modules/restaurant/restaurant-waiter-call.service');
const accountRequests = require('../src/modules/restaurant/restaurant-account-request.service');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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
  const clientUi = read('src/web/restaurant-qr-waiter-call-ui.js');
  const trackingUi = read('src/web/restaurant-qr-tracking-ui.js');
  const waiterUi = read('src/web/restaurant-waiter-call-ui.js');
  const publicRoutes = read('src/modules/restaurant/restaurant-waiter-call.public.routes.js');
  const trackingRoutes = read('src/modules/restaurant/restaurant-client-tracking.public.routes.js');
  const waiterRoutes = read('src/modules/restaurant/restaurant-waiter-call.routes.js');
  const publicIndex = read('src/modules/restaurant/restaurant.public.routes.js');
  const coreRoutes = read('src/routes/core.routes.js');
  const serviceSource = read('src/modules/restaurant/restaurant-waiter-call.service.js');
  const accountServiceSource = read('src/modules/restaurant/restaurant-account-request.service.js');
  const authSource = read('src/middleware/auth-middleware.js');

  for (const token of ['PEDIR AYUDA', 'LLAMAR MESERO', 'MESERO LLAMADO', '/llamar-mesero/stream']) {
    assert.ok(clientUi.includes(token), `Client waiter-call UI must contain ${token}`);
  }
  for (const token of ['ATENDER', 'TU MESA TE ESTÁ LLAMANDO', 'LLAMADO GENERAL', 'SOLICITA LA CUENTA', 'navigator.vibrate', 'AudioContext']) {
    assert.ok(waiterUi.includes(token), `Waiter alert UI must contain ${token}`);
  }
  for (const token of ['PEDIR LA CUENTA', 'CUENTA SOLICITADA', 'PREPARANDO TU CUENTA', 'CUENTA EN CAJA', 'VantixGCQrAccountRequestV1']) {
    assert.ok(trackingUi.includes(token), `QR tracking UI must contain ${token}`);
  }
  assert.doesNotMatch(clientUi, /setInterval|MutationObserver/);
  assert.doesNotMatch(waiterUi, /setInterval|MutationObserver/);
  assert.match(waiterUi, /solicitudes-cuenta/);
  assert.match(publicRoutes, /restaurant-qr-waiter-call-ui\.js/);
  assert.match(publicRoutes, /restaurant-waiter-call-ui\.js/);
  assert.match(publicRoutes, /verifyAccessToken/);
  assert.match(publicRoutes, /verifyWaiterDeviceRequest/);
  assert.match(publicRoutes, /accountRequests\.waiterRequestsSnapshot/);
  assert.match(publicRoutes, /solicitudes-cuenta\/:id\/atender/);
  assert.match(publicRoutes, /X-VantixGC-Waiter-Call', 'v21-account-request'/);
  assert.match(trackingRoutes, /\/pedir-cuenta/);
  assert.match(trackingRoutes, /accountRequests\.createRequest/);
  assert.match(waiterRoutes, /WAITER_DEVICE/);
  assert.match(waiterRoutes, /assertActiveDevice/);
  assert.match(waiterRoutes, /router\.get\('\/llamadas-mesero', async/);
  assert.doesNotMatch(waiterRoutes, /requirePermission\('RESTAURANTE\.VER'\)/);
  assert.match(authSource, /pedidos\|llamadas-mesero/);
  assert.match(publicIndex, /router\.use\(restaurantWaiterCallPublicRouter\);[\s\S]*router\.use\(restaurantVisitPublicRouter\)/);
  assert.match(coreRoutes, /router\.use\('\/restaurante', restaurantWaiterCallRouter\);[\s\S]*router\.use\('\/restaurante', restaurantWaiterDeviceRouter\)/);
  assert.match(serviceSource, /PRIMARY_ONLY_MS = 20_000/);
  assert.match(accountServiceSource, /PRIMARY_ONLY_MS = 20_000/);
  assert.match(accountServiceSource, /ACCOUNT_REQUEST_CREATED/);
  assert.match(accountServiceSource, /identity\.prepareAccount/);
  new Function(clientUi);
  new Function(trackingUi);
  new Function(waiterUi);

  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa:`Waiter Call ${suffix}`,
      subdomain:`waiter-call-${suffix}`,
      nicho:'RESTAURANTE'
    }
  });
  const waiter1 = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'Mesero inicial', email:`w1-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true }
  });
  const waiter2 = await prisma.user.create({
    data: { tenantId:tenant.id, nombre:'Mesero refuerzo', email:`w2-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true }
  });
  const table = await prisma.restaurantTable.create({
    data: { tenantId:tenant.id, code:`T-${suffix.slice(0,4)}`, name:'Mesa llamado', assignedWaiterId:waiter1.id, state:'OCUPADA' }
  });
  const session = await prisma.restaurantTableSession.create({
    data: {
      tenantId:tenant.id,
      tableId:table.id,
      saleId:crypto.randomUUID(),
      openedByUserId:waiter1.id,
      guestCount:2,
      state:'ABIERTA'
    }
  });
  const rawVisitToken = crypto.randomBytes(32).toString('base64url');
  const visitDevice = await prisma.restaurantQrVisitDevice.create({
    data: { tenantId:tenant.id, sessionId:session.id, tokenHash:hash(rawVisitToken), seatNumber:1 }
  });

  const created = await calls.createCall(table.qrToken, rawVisitToken);
  assert.equal(created.active, true);
  assert.equal(created.call.state, 'PENDING_PRIMARY');
  assert.equal(created.call.table.id, table.id);
  assert.equal(created.call.seatNumber, 1);

  const primarySnapshot = await calls.waiterCallsSnapshot(tenant.id, waiter1.id);
  assert.equal(primarySnapshot.calls.length, 1, 'first waiter must receive the call immediately');
  assert.equal(primarySnapshot.calls[0].priority, 'PRIMARY');

  const secondBefore = await calls.waiterCallsSnapshot(tenant.id, waiter2.id);
  assert.equal(secondBefore.calls.length, 0, 'other waiters must not receive the call before escalation');

  await prisma.trackingLink.update({ where:{ id:created.call.id }, data:{ currentStatus:'ESCALATED' } });
  const secondAfter = await calls.waiterCallsSnapshot(tenant.id, waiter2.id);
  assert.equal(secondAfter.calls.length, 1, 'all waiters must receive an escalated call');
  assert.equal(secondAfter.calls[0].priority, 'GENERAL');

  const attended = await calls.attendCall(tenant.id, waiter2.id, created.call.id);
  assert.equal(attended.attended, true);
  assert.equal(attended.alreadyAttended, false);

  const [primaryDone, secondDone, clientDone] = await Promise.all([
    calls.waiterCallsSnapshot(tenant.id, waiter1.id),
    calls.waiterCallsSnapshot(tenant.id, waiter2.id),
    calls.clientCallSnapshot(table.qrToken, rawVisitToken)
  ]);
  assert.equal(primaryDone.calls.length, 0);
  assert.equal(secondDone.calls.length, 0);
  assert.equal(clientDone.active, false);

  const secondCall = await calls.createCall(table.qrToken, rawVisitToken);
  assert.equal(secondCall.active, true);

  const deviceId = crypto.randomUUID();
  await prisma.trackingLink.create({
    data: {
      id:deviceId,
      tenantId:tenant.id,
      tokenHash:hash(crypto.randomBytes(32).toString('base64url')),
      tokenCiphertext:'SMOKE_ACTIVE_WAITER_DEVICE',
      tokenHint:'smoke1',
      originType:'RESTAURANT_WAITER_DEVICE',
      originId:crypto.randomUUID(),
      publicReference:waiter1.id,
      currentStatus:'ACTIVE',
      timeline:[{ type:'DEVICE_PAIRED', at:new Date().toISOString(), waiterUserId:waiter1.id, deviceName:'Smoke tablet', persistent:true }],
      expiresAt:new Date('9999-12-31T23:59:59.000Z'),
      active:true,
      lastNotificationAt:new Date()
    }
  });
  const waiterDeviceToken = signAccessToken({
    userId:waiter1.id,
    tenantId:tenant.id,
    rol:'MESERO',
    deviceId,
    authType:'WAITER_DEVICE',
    permanent:true
  });

  await withServer(async (baseUrl) => {
    const headers = { Authorization:`Bearer ${waiterDeviceToken}`, 'x-tenant-subdomain':tenant.subdomain, Accept:'application/json' };
    const directResponse = await fetch(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, { cache:'no-store', headers });
    const directBody = await directResponse.json().catch(() => ({}));
    assert.equal(directResponse.status, 200, JSON.stringify(directBody));
    assert.equal(directBody?.data?.calls?.length, 1);
    assert.equal(directBody?.data?.accountRequests?.length, 0);

    const attendResponse = await fetch(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas/${encodeURIComponent(secondCall.call.id)}/atender`, {
      method:'POST', cache:'no-store', headers:{ ...headers, 'Content-Type':'application/json' }, body:'{}'
    });
    assert.equal(attendResponse.status, 200);
  });

  const clientAfterHttpAttend = await calls.clientCallSnapshot(table.qrToken, rawVisitToken);
  assert.equal(clientAfterHttpAttend.active, false);

  const consumedOrder = await prisma.restaurantOrder.create({
    data: { tenantId:tenant.id, sessionId:session.id, source:'QR', state:'ENVIADO', qrVisitDeviceId:visitDevice.id, total:19500 }
  });
  await prisma.restaurantOrderItem.create({
    data: {
      tenantId:tenant.id,
      orderId:consumedOrder.id,
      menuItemId:crypto.randomUUID(),
      productId:crypto.randomUUID(),
      saleDetailId:crypto.randomUUID(),
      description:'Producto smoke',
      quantity:1,
      unitPrice:19500,
      lineTotal:19500,
      station:'COCINA',
      seatNumber:1
    }
  });

  const accountCreated = await accountRequests.createRequest(table.qrToken, rawVisitToken);
  assert.equal(accountCreated.state, 'REQUESTED');
  assert.equal(accountCreated.requested, true);
  const accountDuplicate = await accountRequests.createRequest(table.qrToken, rawVisitToken);
  assert.equal(accountDuplicate.state, 'REQUESTED', 'repeated client tap must be idempotent');
  const links = await prisma.trackingLink.findMany({ where:{ tenantId:tenant.id, originType:accountRequests.ORIGIN_TYPE, originId:session.id } });
  assert.equal(links.length, 1, 'one table visit must have one account request record');
  const accountLink = links[0];

  const accountPrimary = await accountRequests.waiterRequestsSnapshot(tenant.id, waiter1.id);
  assert.equal(accountPrimary.length, 1, 'opening waiter must receive account request first');
  assert.equal(accountPrimary[0].priority, 'PRIMARY');
  assert.equal(accountPrimary[0].seatNumber, 1);
  const accountOtherBefore = await accountRequests.waiterRequestsSnapshot(tenant.id, waiter2.id);
  assert.equal(accountOtherBefore.length, 0, 'other waiter must wait for escalation');

  await prisma.trackingLink.update({ where:{ id:accountLink.id }, data:{ currentStatus:'ESCALATED' } });
  const accountOtherAfter = await accountRequests.waiterRequestsSnapshot(tenant.id, waiter2.id);
  assert.equal(accountOtherAfter.length, 1, 'account request must escalate to all waiters');

  await withServer(async (baseUrl) => {
    const waiterHeaders = { Authorization:`Bearer ${waiterDeviceToken}`, 'x-tenant-subdomain':tenant.subdomain, Accept:'application/json' };
    const snapshotResponse = await fetch(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, { cache:'no-store', headers:waiterHeaders });
    const snapshotBody = await snapshotResponse.json().catch(() => ({}));
    assert.equal(snapshotResponse.status, 200, JSON.stringify(snapshotBody));
    assert.equal(snapshotBody?.data?.accountRequests?.length, 1, 'tablet endpoint must receive account request');
    assert.equal(snapshotBody.data.accountRequests[0].id, accountLink.id);

    const attendAccountResponse = await fetch(`${baseUrl}/api/public/restaurante/mesero-dispositivo/solicitudes-cuenta/${encodeURIComponent(accountLink.id)}/atender`, {
      method:'POST', cache:'no-store', headers:{ ...waiterHeaders, 'Content-Type':'application/json' }, body:'{}'
    });
    const attendAccountBody = await attendAccountResponse.json().catch(() => ({}));
    assert.equal(attendAccountResponse.status, 200, JSON.stringify(attendAccountBody));
    assert.equal(attendAccountBody?.data?.attended, true);

    const clientHeaders = { 'x-vantix-restaurant-visit':rawVisitToken, Accept:'application/json' };
    const trackingResponse = await fetch(`${baseUrl}/api/public/restaurante/qr/${encodeURIComponent(table.qrToken)}/mis-pedidos`, { cache:'no-store', headers:clientHeaders });
    const trackingBody = await trackingResponse.json().catch(() => ({}));
    assert.equal(trackingResponse.status, 200, JSON.stringify(trackingBody));
    assert.equal(trackingBody?.data?.account?.state, 'PREPARING', 'client must see PREPARING after waiter attends');
  });

  const preparingStatus = await accountRequests.clientStatus(table.qrToken, rawVisitToken);
  assert.equal(preparingStatus.state, 'PREPARING');
  const noRepeatAfterPrepare = await accountRequests.createRequest(table.qrToken, rawVisitToken);
  assert.equal(noRepeatAfterPrepare.state, 'PREPARING', 'prepared account must not create a second request');

  await prisma.restaurantTableSession.update({ where:{ id:session.id }, data:{ cashierRequestedAt:new Date() } });
  const cashStatus = await accountRequests.clientStatus(table.qrToken, rawVisitToken);
  assert.equal(cashStatus.state, 'IN_CASH');

  console.log('RESTAURANT WAITER CALL + QR ACCOUNT REQUEST DB SMOKE OK');
  console.log(JSON.stringify({
    waiterCallPrimaryThenAll:true,
    accountRequestPrimaryThenAll:true,
    accountRequestIdempotent:true,
    accountRequestSeatTracked:true,
    linkedDeviceReceivesAccountRequest:true,
    waiterAttendPreparesAccount:true,
    clientTracksRequestedPreparingAndCash:true,
    accountEscalationMs:accountRequests.PRIMARY_ONLY_MS,
    clientPolling:false,
    waiterSetInterval:false,
    foregroundSafetySnapshotMs:5000
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
