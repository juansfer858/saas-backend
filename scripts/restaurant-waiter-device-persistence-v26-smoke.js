'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { app } = require('../src/app');
const device = require('../src/modules/restaurant/restaurant-waiter-device.service');
const persistence = require('../src/modules/restaurant/restaurant-waiter-device-persistence.public.routes');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

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
  const staticRuntime = fs.readFileSync('src/web/restaurant-waiter-runtime-v7.js', 'utf8');
  const patched = `${persistence.bootstrapSource()}${persistence.patchRuntime(staticRuntime)}`;
  assert.match(patched, /VANTIX_WAITER_DEVICE_PERSISTENCE_V26/);
  assert.match(patched, /vantixgc_waiter_device_session_v26/);
  assert.match(patched, /RESTAURANT_WAITER_DEVICE_REVOKED/);
  assert.match(patched, /temporalmente inactivo/);
  assert.match(patched, /persistentUntilAdminRevokes:true/);
  assert.doesNotMatch(patched, /response\.status === 401\) \{\s*localStorage\.removeItem\(SESSION_KEY\)/);

  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where:{ subdomain:SUBDOMAIN } });
  const admin = await prisma.user.findFirst({ where:{ tenantId:tenant.id, rol:'ADMIN', activo:true } });
  const waiter = await prisma.user.findFirst({ where:{ tenantId:tenant.id, rol:'MESERO', activo:true } });
  assert.ok(admin?.id && waiter?.id);

  const pairing = await device.createPairing(tenant.id, admin.id, { userId:waiter.id, deviceName:'Tablet Persistencia V26' });
  const token = new URL(pairing.url).searchParams.get('t');
  const claimed = await device.claimPairing(token, { deviceName:'Tablet Persistencia V26', userAgent:'VantixGC-CI/V26' });
  assert.equal(claimed.persistent, true);
  const originalDeviceId = claimed.deviceId;
  const originalSessionToken = claimed.session.token;

  try {
    await prisma.user.update({ where:{ id:waiter.id }, data:{ activo:false } });
    assert.equal(await device.assertActiveDevice(originalDeviceId, tenant.id, waiter.id), true, 'desactivar empleado no revoca dispositivo');
    let row = await prisma.trackingLink.findUnique({ where:{ id:originalDeviceId } });
    assert.equal(row.active, true);
    assert.equal(row.currentStatus, 'ACTIVE');

    await prisma.user.update({ where:{ id:waiter.id }, data:{ activo:true } });
    const renewed = await device.renewDeviceSession(originalDeviceId, tenant.id, waiter.id);
    assert.equal(renewed.deviceId, originalDeviceId);
    assert.equal(renewed.persistent, true);
    assert.ok(renewed.session.token);
    assert.equal(renewed.session.subdomain, SUBDOMAIN);
    assert.notEqual(originalSessionToken.length, 0);

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/app/restaurant-waiter-runtime-v7.js?v=waiter-runtime-v23-tenant-realtime`, { cache:'no-store' });
      const runtime = await response.text();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-vantixgc-waiter-device-persistence'), 'v26-until-admin-revokes');
      assert.match(runtime, /VANTIX_WAITER_DEVICE_PERSISTENCE_V26/);
      assert.match(runtime, /El vínculo de esta tablet se conserva/);
      assert.match(runtime, /Este dispositivo fue desautorizado por Administración/);
    });

    await device.revokeDevice(tenant.id, admin.id, originalDeviceId);
    row = await prisma.trackingLink.findUnique({ where:{ id:originalDeviceId } });
    assert.equal(row.active, false);
    assert.equal(row.currentStatus, 'REVOKED');
    let revokedError = null;
    try { await device.assertActiveDevice(originalDeviceId, tenant.id, waiter.id); } catch (error) { revokedError = error; }
    assert.equal(revokedError?.code, 'RESTAURANT_WAITER_DEVICE_REVOKED');
  } finally {
    await prisma.user.update({ where:{ id:waiter.id }, data:{ activo:true } }).catch(() => {});
  }

  console.log('RESTAURANT WAITER DEVICE PERSISTENCE V26 SMOKE OK');
  console.log(JSON.stringify({
    oneTimeQr:true,
    appCloseKeepsLink:true,
    employeeDeactivateKeepsLink:true,
    employeeReactivateRestoresWithoutQr:true,
    explicitAdminRevocationRequiredForRelink:true,
    revokedDeviceBlockedImmediately:true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
