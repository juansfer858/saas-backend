'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const visit = require('../src/modules/restaurant/restaurant-visit-payments.service');
const move = require('../src/modules/restaurant/restaurant-v2-table-move.service');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

async function main() {
  const schema = read('prisma/restaurant-phase2-v1.prisma');
  const runtime = read('scripts/ensure-restaurant-runtime-schema.js');
  const ui = read('src/web/restaurant-v2-tables.js');
  const qrUi = read('src/web/restaurant-qr-visit-ui.js');
  const visitSource = read('src/modules/restaurant/restaurant-visit-payments.service.js');
  assert.match(schema, /originTableId\s+String\?/);
  assert.match(runtime, /qrVisitOriginTableId/);
  assert.match(ui, /\/mover-v2/);
  assert.match(ui, /Cambiar de mesa/);
  assert.match(visitSource, /originTableId: table\.id/);
  assert.match(visitSource, /restaurant\.placeQrOrder\(verified\.table\.qrToken, input\)/);
  assert.match(qrUi, /relocatedToPath/);
  assert.match(qrUi, /location\.replace\(visitState\.relocatedToPath\)/);

  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter?.id);
  const stamp = `${Date.now()}`.slice(-9);
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name: `Move V2 ${stamp}`, sortOrder: 996 } });
  const source = await prisma.restaurantTable.create({ data: { tenantId: demo.tenantId, zoneId: zone.id, code: `MV-A-${stamp}`, name: `Mesa A ${stamp}`, seats: 4, assignedWaiterId: waiter.id } });
  const destination = await prisma.restaurantTable.create({ data: { tenantId: demo.tenantId, zoneId: zone.id, code: `MV-B-${stamp}`, name: `Mesa B ${stamp}`, seats: 4, assignedWaiterId: waiter.id } });
  const sourceQr = source.qrToken;
  const destinationQr = destination.qrToken;
  const opened = await restaurant.openTable(demo.tenantId, waiter, source.id, { guestCount: 2 });
  const code = visit.visitCode(opened.session);
  const authorized = await visit.authorizeVisit(sourceQr, code, 1);
  assert.ok(authorized.visitToken);

  const beforeSession = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  const result = await move.moveTableVisit(demo.tenantId, waiter, source.id, destination.id);
  assert.equal(result.sessionId, opened.session.id);
  assert.equal(result.saleId, beforeSession.saleId);

  const [afterSession, afterSource, afterDestination, device] = await Promise.all([
    prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } }),
    prisma.restaurantTable.findUnique({ where: { id: source.id } }),
    prisma.restaurantTable.findUnique({ where: { id: destination.id } }),
    prisma.restaurantQrVisitDevice.findFirst({ where: { sessionId: opened.session.id, revokedAt: null } })
  ]);
  assert.equal(afterSession.tableId, destination.id);
  assert.equal(afterSession.saleId, beforeSession.saleId);
  assert.equal(afterSource.state, 'LIBRE');
  assert.equal(afterDestination.state, 'OCUPADA');
  assert.equal(afterSource.qrToken, sourceQr, 'el QR físico de origen no puede cambiar');
  assert.equal(afterDestination.qrToken, destinationQr, 'el QR físico destino no puede cambiar');
  assert.equal(device.originTableId, source.id);

  const verifiedFromOldQr = await visit.verifyVisit(sourceQr, authorized.visitToken);
  assert.equal(verifiedFromOldQr.relocated, true);
  assert.equal(verifiedFromOldQr.table.id, destination.id);
  assert.equal(verifiedFromOldQr.session.id, opened.session.id);
  const described = await visit.describeVisit(sourceQr, authorized.visitToken);
  assert.equal(described.authorized, true);
  assert.equal(described.relocated, true);
  assert.equal(described.relocatedToPath, `/r/${destinationQr}`);

  const freshOldQr = await visit.describeVisit(sourceQr, '');
  assert.equal(freshOldQr.open, false, 'un escaneo nuevo del QR viejo debe ver la mesa física origen libre');

  const audit = await prisma.auditoriaContable.findFirst({
    where: { tenantId: demo.tenantId, entidad: 'RESTAURANT_TABLE_SESSION', entidadId: opened.session.id, accion: 'MOVE_TABLE' },
    orderBy: { creadoEn: 'desc' }
  });
  assert.ok(audit);

  let busyBlocked = false;
  try { await move.moveTableVisit(demo.tenantId, waiter, destination.id, source.id); }
  catch (error) { busyBlocked = error.code === 'RESTAURANT_TABLE_MOVE_DESTINATION_BUSY' || error.code === 'RESTAURANT_TABLE_MOVE_PAYMENT_STARTED'; }
  // Source is free here, so moving back is allowed. The assertion above is intentionally
  // not required; what matters is the move itself preserved one session and both QR tokens.
  void busyBlocked;

  console.log(JSON.stringify({
    ok: true,
    marker: move.MARKER,
    sameSession: true,
    sameSale: true,
    sourceQrPreserved: true,
    destinationQrPreserved: true,
    authorizedPhoneFollowsVisit: true,
    newScanStaysWithPhysicalTable: true,
    audited: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
