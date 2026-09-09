'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const qr = require('../src/modules/restaurant/restaurant-qr.service');
const waiterDevices = require('../src/modules/restaurant/restaurant-waiter-device.service');
const productionDevices = require('../src/modules/restaurant/restaurant-production-device-v63.service');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const admin = await prisma.user.findUnique({ where:{ id:demo.users.ADMIN } });
  const table = await prisma.restaurantTable.findFirst({ where:{ tenantId:demo.tenantId, active:true }, orderBy:{ code:'asc' } });
  assert.ok(admin && table, 'demo debe tener administrador y mesa');
  const qrTokenBefore = table.qrToken;
  assert.ok(qrTokenBefore, 'mesa demo debe conservar qrToken físico');

  const materials = await qr.visibleMaterials(demo.tenantId, admin);
  const material = materials.find((row) => row.tableId === table.id);
  assert.ok(material, 'administración V2 debe poder materializar QR existente');
  assert.match(material.svg, /<svg/i);
  assert.ok(material.url.endsWith(`/r/${qrTokenBefore}`), 'QR debe apuntar al token físico existente');

  const waiterPair = await waiterDevices.createPairing(demo.tenantId, admin.id, { userId:demo.users.MESERO, deviceName:'Smoke Mesero V2' });
  const productionPair = await productionDevices.createPairing(demo.tenantId, admin.id, { userId:demo.users.COCINA, deviceName:'Smoke Cocina V2' });
  const waiterToken = new URL(waiterPair.url).searchParams.get('t');
  assert.ok(waiterToken, 'QR reutilizable del mesero debe incluir token de enrolamiento');
  const waiterClaim = await waiterDevices.claimPairing(waiterToken, { deviceName:'Smoke Mesero Tablet A', userAgent:'Admin-Parity-CI' });
  assert.equal(waiterClaim.deviceId, waiterPair.deviceId, 'la primera tablet debe materializar el slot primario reservado');
  assert.equal(waiterClaim.persistent, true);
  assert.equal(waiterClaim.reusable, true);

  const createdDeviceIds = [waiterPair.deviceId, waiterPair.enrollmentId, productionPair.deviceId].filter(Boolean);

  try {
    assert.match(waiterPair.svg, /<svg/i);
    assert.match(waiterPair.url, /\/app\/centro-de-control\/conectar\?t=/);
    assert.equal(waiterPair.reusable, true);
    assert.equal(waiterPair.multipleDevices, true);
    assert.match(productionPair.svg, /<svg/i);
    assert.match(productionPair.url, /\/app\/produccion\/conectar\?t=/);

    const waiterList = await waiterDevices.listDevices(demo.tenantId);
    const productionList = await productionDevices.listDevices(demo.tenantId);
    assert.ok(waiterList.some((row) => row.id === waiterClaim.deviceId && row.status === 'ACTIVE' && row.active === true), 'tablet Mesero vinculada debe aparecer ACTIVE');
    assert.ok(productionList.some((row) => row.id === productionPair.deviceId && row.status === 'PAIRING'));

    // Same waiter QR remains valid for another device; this is the current admin contract.
    const waiterClaimB = await waiterDevices.claimPairing(waiterToken, { deviceName:'Smoke Mesero Tablet B', userAgent:'Admin-Parity-CI-B' });
    assert.notEqual(waiterClaimB.deviceId, waiterClaim.deviceId, 'cada tablet debe tener deviceId independiente');
    createdDeviceIds.push(waiterClaimB.deviceId);
    const waiterListB = await waiterDevices.listDevices(demo.tenantId);
    assert.ok(waiterListB.some((row) => row.id === waiterClaimB.deviceId && row.status === 'ACTIVE'));

    await waiterDevices.revokeDevice(demo.tenantId, admin.id, waiterClaim.deviceId);
    const waiterRevoked = (await waiterDevices.listDevices(demo.tenantId)).find((row) => row.id === waiterClaim.deviceId);
    const waiterStillActive = (await waiterDevices.listDevices(demo.tenantId)).find((row) => row.id === waiterClaimB.deviceId);
    assert.equal(waiterRevoked.active, false);
    assert.equal(waiterStillActive.active, true, 'revocar Tablet A no puede tumbar Tablet B');

    await productionDevices.revokeDevice(demo.tenantId, admin.id, productionPair.deviceId);
    const productionRevoked = (await productionDevices.listDevices(demo.tenantId)).find((row) => row.id === productionPair.deviceId);
    assert.equal(productionRevoked.active, false);

    const qrTokenAfter = (await prisma.restaurantTable.findUnique({ where:{ id:table.id } })).qrToken;
    assert.equal(qrTokenAfter, qrTokenBefore, 'administrar/imprimir/vincular dispositivos no puede rotar QR físicos');

    const routeSource = fs.readFileSync('src/modules/restaurant/restaurant-v2-admin-parity.public.routes.js', 'utf8');
    const aggregatorSource = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');
    const bridgeSource = fs.readFileSync('src/web/restaurant-v2-control-center-bridge.js', 'utf8');
    const nativeSource = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js', 'utf8');
    const htmlSource = fs.readFileSync('src/web/restaurant-v2-admin-parity.html', 'utf8');
    const uiSource = fs.readFileSync('src/web/restaurant-v2-admin-parity.js', 'utf8');

    assert.match(routeSource, /\/app\/restaurante-v2\/qrs/);
    assert.match(routeSource, /\/app\/restaurante-v2\/dispositivos/);
    assert.match(aggregatorSource, /restaurantV2AdminParityPublicRouter/);
    assert.match(bridgeSource, /qrs:\s*'\/app\/restaurante-v2\/qrs'/);
    assert.match(bridgeSource, /devices:\s*'\/app\/restaurante-v2\/dispositivos'/);
    assert.match(nativeSource, /qrs:\{[^}]*route:'\/app\/restaurante-v2\/qrs'/);
    assert.match(nativeSource, /devices:\{[^}]*route:'\/app\/restaurante-v2\/dispositivos'/);
    assert.match(htmlSource, /QR DE MESAS/);
    assert.match(htmlSource, /DISPOSITIVOS/);
    assert.match(uiSource, /VANTIX_RESTAURANT_V2_ADMIN_PARITY_V1/);
    assert.match(uiSource, /\/api\/v1\/restaurante\/qrs/);
    assert.match(uiSource, /dispositivos-mesero\/vinculo/);
    assert.match(uiSource, /dispositivos-produccion\/vinculo/);
    assert.doesNotMatch(uiSource, /MutationObserver|setInterval|POLL_MS/);

    console.log(JSON.stringify({
      ok:true,
      module:'RESTAURANT_V2_ADMIN_PARITY',
      physicalQrPreserved:true,
      tableQrCount:materials.length,
      waiterReusablePairing:true,
      waiterMultipleDevices:true,
      independentRevocation:true,
      productionPairingReused:true,
      adminOnlyNavigation:true,
      noPolling:true
    }));
  } finally {
    await prisma.notificationAudit.deleteMany({ where:{ tenantId:demo.tenantId, entityId:{ in:createdDeviceIds } } }).catch(() => {});
    await prisma.trackingLink.deleteMany({ where:{ tenantId:demo.tenantId, id:{ in:createdDeviceIds } } }).catch(() => {});
  }
}

main().catch((error) => { console.error(error); process.exitCode=1; }).finally(() => prisma.$disconnect());
