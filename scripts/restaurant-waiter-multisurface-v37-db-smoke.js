'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');
const { signAccessToken } = require('../src/utils/jwt');
const calls = require('../src/modules/restaurant/restaurant-waiter-call.service');

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

async function withServer(run) {
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function token(user, extra = {}) {
  return signAccessToken({ userId:user.id, tenantId:user.tenantId, rol:user.rol, ...extra });
}

async function jsonGet(url, headers) {
  const response = await fetch(url, { cache:'no-store', headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({ data:{ nombreEmpresa:`Waiter V37 ${suffix}`, subdomain:`waiter-v37-${suffix}`, nicho:'RESTAURANTE' } });
  const waiter1 = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Mesero principal', email:`w37-a-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true } });
  const waiter2 = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Mesero refuerzo', email:`w37-b-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true } });
  const admin = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Admin salón', email:`w37-admin-${suffix}@test.local`, password:'test', rol:'ADMIN', activo:true } });
  const table = await prisma.restaurantTable.create({ data:{ tenantId:tenant.id, code:`V37-${suffix.slice(0,4)}`, name:'Mesa V37', assignedWaiterId:waiter1.id, state:'OCUPADA' } });
  const session = await prisma.restaurantTableSession.create({ data:{ tenantId:tenant.id, tableId:table.id, saleId:crypto.randomUUID(), openedByUserId:waiter1.id, guestCount:2, state:'ABIERTA' } });
  const visitRaw = crypto.randomBytes(32).toString('base64url');
  await prisma.restaurantQrVisitDevice.create({ data:{ tenantId:tenant.id, sessionId:session.id, tokenHash:hash(visitRaw), seatNumber:1 } });

  const call = await calls.createCall(table.qrToken, visitRaw);
  assert.equal(call.active, true);
  assert.equal(call.call.state, 'PENDING_PRIMARY');

  const linkedDeviceId = crypto.randomUUID();
  await prisma.trackingLink.create({
    data:{
      id:linkedDeviceId, tenantId:tenant.id, tokenHash:hash(crypto.randomBytes(32).toString('base64url')),
      tokenCiphertext:'V37_ACTIVE_WAITER_DEVICE', tokenHint:'v37dev', originType:'RESTAURANT_WAITER_DEVICE',
      originId:crypto.randomUUID(), publicReference:waiter1.id, currentStatus:'ACTIVE',
      timeline:[{ type:'DEVICE_PAIRED', at:new Date().toISOString(), waiterUserId:waiter1.id, deviceName:'Tablet V37', persistent:true }],
      expiresAt:new Date('9999-12-31T23:59:59.000Z'), active:true, lastNotificationAt:new Date()
    }
  });

  const normalWaiterToken = token(waiter1, { authType:'USER' });
  const linkedWaiterToken = token(waiter1, { authType:'WAITER_DEVICE', deviceId:linkedDeviceId, permanent:true });
  const otherWaiterToken = token(waiter2, { authType:'USER' });
  const adminToken = token(admin, { authType:'USER' });

  await withServer(async (baseUrl) => {
    const headers = (raw) => ({ Authorization:`Bearer ${raw}`, 'x-tenant-subdomain':tenant.subdomain, Accept:'application/json' });

    const pc = await jsonGet(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, headers(normalWaiterToken));
    assert.equal(pc.response.status, 200, JSON.stringify(pc.body));
    assert.equal(pc.body?.data?.calls?.length, 1, 'PC session of primary waiter must receive call');
    assert.equal(pc.body.data.calls[0].priority, 'PRIMARY');

    const device = await jsonGet(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, headers(linkedWaiterToken));
    assert.equal(device.response.status, 200, JSON.stringify(device.body));
    assert.equal(device.body?.data?.calls?.length, 1, 'linked waiter device must receive call');
    assert.equal(device.body.data.calls[0].id, pc.body.data.calls[0].id);

    const other = await jsonGet(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, headers(otherWaiterToken));
    assert.equal(other.response.status, 200, JSON.stringify(other.body));
    assert.equal(other.body?.data?.calls?.length, 0, 'another waiter must still wait for escalation');

    const adminView = await jsonGet(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas`, headers(adminToken));
    assert.equal(adminView.response.status, 200, JSON.stringify(adminView.body));
    assert.equal(adminView.body?.data?.calls?.length, 1, 'admin Mesero view must receive active call');

    const corePc = await jsonGet(`${baseUrl}/api/v1/restaurante/llamadas-mesero`, headers(normalWaiterToken));
    assert.equal(corePc.response.status, 200, JSON.stringify(corePc.body));
    assert.equal(corePc.body?.data?.calls?.length, 1);

    const attend = await fetch(`${baseUrl}/api/public/restaurante/mesero-dispositivo/llamadas/${encodeURIComponent(call.call.id)}/atender`, {
      method:'POST', cache:'no-store', headers:{ ...headers(adminToken), 'Content-Type':'application/json' }, body:'{}'
    });
    const attendBody = await attend.json().catch(() => ({}));
    assert.equal(attend.status, 200, JSON.stringify(attendBody));
    assert.equal(attendBody?.data?.attended, true);
  });

  const clientAfter = await calls.clientCallSnapshot(table.qrToken, visitRaw);
  assert.equal(clientAfter.active, false);

  console.log('RESTAURANT WAITER MULTISURFACE V37 DB SMOKE OK', JSON.stringify({
    pcNormalSessionReceives:true,
    linkedDeviceReceives:true,
    sameCallAcrossSurfaces:true,
    primaryEscalationPreserved:true,
    adminSupervision:true,
    coreAuthenticatedChannel:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
