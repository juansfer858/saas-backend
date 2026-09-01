'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const calls = require('../src/modules/restaurant/restaurant-waiter-call.service');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function main() {
  const clientUi = read('src/web/restaurant-qr-waiter-call-ui.js');
  const waiterUi = read('src/web/restaurant-waiter-call-ui.js');
  const publicRoutes = read('src/modules/restaurant/restaurant-waiter-call.public.routes.js');
  const waiterRoutes = read('src/modules/restaurant/restaurant-waiter-call.routes.js');
  const publicIndex = read('src/modules/restaurant/restaurant.public.routes.js');
  const coreRoutes = read('src/routes/core.routes.js');
  const serviceSource = read('src/modules/restaurant/restaurant-waiter-call.service.js');

  for (const token of ['PEDIR AYUDA', 'LLAMAR MESERO', 'MESERO LLAMADO', '/llamar-mesero/stream']) {
    assert.ok(clientUi.includes(token), `Client waiter-call UI must contain ${token}`);
  }
  for (const token of ['ATENDER', 'TU MESA TE ESTÁ LLAMANDO', 'LLAMADO GENERAL', 'navigator.vibrate', 'AudioContext', '/llamadas-mesero/stream']) {
    assert.ok(waiterUi.includes(token), `Waiter call UI must contain ${token}`);
  }
  assert.doesNotMatch(clientUi, /setInterval|MutationObserver/);
  assert.doesNotMatch(waiterUi, /setInterval|MutationObserver/);
  assert.match(publicRoutes, /restaurant-qr-waiter-call-ui\.js/);
  assert.match(publicRoutes, /restaurant-waiter-call-ui\.js/);
  assert.match(publicRoutes, /waiterRuntimeV14/);
  assert.match(publicRoutes, /X-VantixGC-Waiter-Runtime', 'v14-review-hard-gate'/);
  assert.match(publicRoutes, /X-VantixGC-Waiter-Call', 'v2-resume-snapshot'/);
  assert.match(waiterRoutes, /WAITER_DEVICE/);
  assert.match(waiterRoutes, /assertActiveDevice/);
  assert.match(waiterRoutes, /llamadas-mesero\/:id\/atender/);
  assert.match(publicIndex, /router\.use\(restaurantWaiterCallPublicRouter\);[\s\S]*router\.use\(restaurantVisitPublicRouter\)/);
  assert.match(coreRoutes, /router\.use\('\/restaurante', restaurantWaiterCallRouter\);[\s\S]*router\.use\('\/restaurante', restaurantWaiterDeviceRouter\)/);
  assert.match(serviceSource, /PRIMARY_ONLY_MS = 20_000/);
  assert.match(serviceSource, /session\.openedByUserId/);
  assert.match(serviceSource, /currentStatus: 'ESCALATED'/);
  assert.match(serviceSource, /currentStatus: 'ATTENDED'/);
  new Function(clientUi);
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
  await prisma.restaurantQrVisitDevice.create({
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

  await prisma.trackingLink.update({
    where: { id:created.call.id },
    data: { currentStatus:'ESCALATED' }
  });

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
  assert.equal(primaryDone.calls.length, 0, 'attended call must disappear from primary waiter');
  assert.equal(secondDone.calls.length, 0, 'attended call must disappear from every waiter');
  assert.equal(clientDone.active, false, 'client call button must reset after attendance');

  const secondCall = await calls.createCall(table.qrToken, rawVisitToken);
  assert.equal(secondCall.active, true, 'same table may call again after previous attendance');
  assert.equal(secondCall.call.state, 'PENDING_PRIMARY');

  console.log('RESTAURANT WAITER CALL ESCALATION DB SMOKE OK');
  console.log(JSON.stringify({
    primaryWaiterFirst:true,
    escalatesToAll:true,
    escalationMs:calls.PRIMARY_ONLY_MS,
    singleAttendanceClearsAll:true,
    clientVisitAuthorizationRequired:true,
    canCallAgainAfterAttendance:true,
    clientPolling:false,
    waiterPolling:false
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
