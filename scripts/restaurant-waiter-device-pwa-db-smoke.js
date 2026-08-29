'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { verifyAccessToken } = require('../src/utils/jwt');
const device = require('../src/modules/restaurant/restaurant-waiter-device.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

async function rejectsCode(promise, code) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `Se esperaba error ${code}`);
  assert.equal(error.code, code);
  return error;
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
  assert.match(pairing.svg, /<svg/);
  assert.equal(pairing.waiter.id, waiter.id);
  const url = new URL(pairing.url);
  const rawToken = url.searchParams.get('t');
  assert.ok(rawToken && rawToken.length >= 20, 'token temporal faltante');

  const inspected = await device.inspectPairing(rawToken);
  assert.equal(inspected.deviceId, pairing.deviceId);
  assert.equal(inspected.waiter.id, waiter.id);
  assert.equal(inspected.tenant.subdomain, SUBDOMAIN);

  const claimed = await device.claimPairing(rawToken, { deviceName: 'Tablet Stress Mesero 01', userAgent: 'VantixGC-CI/1.0' });
  assert.equal(claimed.deviceId, pairing.deviceId);
  assert.equal(claimed.session.subdomain, SUBDOMAIN);
  assert.equal(claimed.session.user.id, waiter.id);
  assert.equal(claimed.session.user.rol, 'MESERO');

  const payload = verifyAccessToken(claimed.session.token);
  assert.equal(payload.userId, waiter.id);
  assert.equal(payload.tenantId, tenant.id);
  assert.equal(payload.rol, 'MESERO');
  assert.equal(payload.deviceId, pairing.deviceId);
  assert.equal(payload.authType, 'WAITER_DEVICE');

  await rejectsCode(device.inspectPairing(rawToken), 'RESTAURANT_WAITER_PAIRING_EXPIRED');
  await rejectsCode(device.claimPairing(rawToken, { deviceName:'Segundo intento' }), 'RESTAURANT_WAITER_PAIRING_EXPIRED');

  assert.equal(await device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id), true);
  const listed = await device.listDevices(tenant.id);
  const listedDevice = listed.find((row) => row.id === pairing.deviceId);
  assert.ok(listedDevice, 'dispositivo no apareció en administración');
  assert.equal(listedDevice.active, true);
  assert.equal(listedDevice.waiter.id, waiter.id);
  assert.equal(listedDevice.deviceName, 'Tablet Stress Mesero 01');

  const beforeThrottle = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId }, select: { lastNotificationAt:true } });
  assert.ok(beforeThrottle?.lastNotificationAt);
  await device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id);
  const afterThrottle = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId }, select: { lastNotificationAt:true } });
  assert.equal(afterThrottle.lastNotificationAt.getTime(), beforeThrottle.lastNotificationAt.getTime(), 'validar cada request no debe escribir last-seen inmediatamente');

  const revoked = await device.revokeDevice(tenant.id, admin.id, pairing.deviceId);
  assert.equal(revoked.revoked, true);
  await rejectsCode(device.assertActiveDevice(pairing.deviceId, tenant.id, waiter.id), 'RESTAURANT_WAITER_DEVICE_REVOKED');

  const row = await prisma.trackingLink.findUnique({ where: { id: pairing.deviceId } });
  assert.equal(row.active, false);
  assert.equal(row.currentStatus, 'REVOKED');

  const audits = await prisma.notificationAudit.findMany({
    where: { tenantId: tenant.id, entity: 'RestaurantWaiterDevice', entityId: pairing.deviceId },
    orderBy: { creadoEn:'asc' }
  });
  const actions = audits.map((audit) => audit.action);
  assert.ok(actions.includes('WAITER_DEVICE_PAIRING_CREATED'));
  assert.ok(actions.includes('WAITER_DEVICE_PAIRED'));
  assert.ok(actions.includes('WAITER_DEVICE_REVOKED'));

  console.log(JSON.stringify({
    ok:true,
    tenant:seeded.subdomain,
    deviceId:pairing.deviceId,
    waiter:waiter.nombre,
    oneTimePairing:true,
    jwtBoundToDevice:true,
    revocationImmediate:true,
    auditActions:actions
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
