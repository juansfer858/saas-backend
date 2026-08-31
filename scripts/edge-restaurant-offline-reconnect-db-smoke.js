'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const edgeRestaurant = require('../src/modules/edge/edge-restaurant-sync.service');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  assert.ok(waiter && admin, 'demo waiter/admin must exist');

  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const zone = await prisma.restaurantZone.create({
    data: { tenantId: demo.tenantId, name: `Edge Reconnect ${stamp}`, sortOrder: 998 }
  });
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `ER-${stamp}`.slice(0, 50),
      name: `Mesa Edge Reconnect ${stamp}`,
      seats: 6,
      assignedWaiterId: waiter.id
    }
  });
  const menu = await prisma.restaurantMenuItem.findMany({
    where: { tenantId: demo.tenantId, active: true },
    orderBy: { sortOrder: 'asc' },
    take: 2
  });
  assert.ok(menu.length >= 2, 'demo menu must contain at least two products');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount: 1, billingMode: 'CONJUNTA' });
  const edgeAgent = await prisma.edgeAgent.create({
    data: {
      tenantId: demo.tenantId,
      name: `Edge reconnect ${stamp}`,
      pointCode: `ER-${stamp}`.slice(0, 80),
      credentialHash: crypto.createHash('sha256').update(`edge-${stamp}`).digest('hex'),
      serviceUserId: waiter.id,
      createdByUserId: admin.id,
      softwareVersion: 'offline-waiter-v2-smoke'
    }
  });
  const agent = { ...edgeAgent, serviceUser: waiter };

  const op1 = {
    id: `offline-order-1-${stamp}`,
    type: 'RESTAURANT_ORDER_CREATE',
    localTimestamp: new Date().toISOString(),
    payload: {
      sessionId: opened.session.id,
      items: [{
        menuItemId: menu[0].id,
        quantity: 1,
        seatNumber: 2,
        notes: 'Persona 2 offline',
        serviceBillingMode: 'INDIVIDUAL',
        serviceGuestCount: 2
      }]
    }
  };

  let synced = await edgeRestaurant.processOperations(agent, [op1]);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].ok, true, JSON.stringify(synced));
  assert.equal(synced[0].state, 'SYNCED');
  assert.ok(synced[0].originDocumentId);

  let session = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  assert.equal(session.billingMode, 'INDIVIDUAL');
  assert.equal(session.guestCount, 2);

  const firstOrderId = synced[0].originDocumentId;
  let firstItem = await prisma.restaurantOrderItem.findFirst({ where: { tenantId: demo.tenantId, orderId: firstOrderId } });
  assert.ok(firstItem);
  assert.equal(firstItem.seatNumber, 2);
  assert.equal(firstItem.notes, 'Persona 2 offline');

  const beforeReplayCount = await prisma.restaurantOrder.count({ where: { tenantId: demo.tenantId, sessionId: opened.session.id } });
  synced = await edgeRestaurant.processOperations(agent, [op1]);
  assert.equal(synced[0].ok, true);
  assert.equal(synced[0].originDocumentId, firstOrderId);
  const afterReplayCount = await prisma.restaurantOrder.count({ where: { tenantId: demo.tenantId, sessionId: opened.session.id } });
  assert.equal(afterReplayCount, beforeReplayCount, 'replaying the same Edge operation must not duplicate the order');

  const op2 = {
    id: `offline-order-2-${stamp}`,
    type: 'RESTAURANT_ORDER_CREATE',
    localTimestamp: new Date(Date.now() + 1000).toISOString(),
    payload: {
      sessionId: opened.session.id,
      items: [{
        menuItemId: menu[1].id,
        quantity: 1,
        seatNumber: 1,
        notes: 'Despues de quitar Persona 2',
        serviceBillingMode: 'INDIVIDUAL',
        serviceGuestCount: 1
      }]
    }
  };

  synced = await edgeRestaurant.processOperations(agent, [op2]);
  assert.equal(synced[0].ok, true, JSON.stringify(synced));
  session = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  assert.equal(session.billingMode, 'INDIVIDUAL');
  assert.equal(session.guestCount, 1);

  firstItem = await prisma.restaurantOrderItem.findFirst({ where: { tenantId: demo.tenantId, orderId: firstOrderId } });
  assert.equal(firstItem.seatNumber, 1, 'existing central consumption from removed Persona 2 must migrate to Persona 1');
  const secondItem = await prisma.restaurantOrderItem.findFirst({ where: { tenantId: demo.tenantId, orderId: synced[0].originDocumentId } });
  assert.ok(secondItem);
  assert.equal(secondItem.seatNumber, 1);
  assert.equal(secondItem.notes, 'Despues de quitar Persona 2');

  const receipts = await prisma.edgeSyncReceipt.findMany({
    where: { edgeAgentId: edgeAgent.id, operationId: { in: [op1.id, op2.id] } },
    orderBy: { localTimestamp: 'asc' }
  });
  assert.equal(receipts.length, 2);
  assert.equal(receipts.every((row) => row.state === 'SYNCED'), true);

  const bootstrap = await edgeRestaurant.buildRestaurantBootstrap(agent);
  const bootTable = bootstrap.tables.find((row) => row.id === table.id);
  assert.ok(bootTable?.activeSession);
  assert.equal(bootTable.activeSession.billingMode, 'INDIVIDUAL');
  assert.equal(bootTable.activeSession.guestCount, 1);
  const commands = bootstrap.commands.filter((row) => [firstOrderId, synced[0].originDocumentId].includes(row.orderId));
  assert.ok(commands.length >= 1, 'bootstrap must expose offline-synced commands to KDS');
  const seats = commands.flatMap((command) => command.items).map((item) => item.seatNumber).filter((value) => value != null);
  assert.ok(seats.length >= 1);
  assert.equal(seats.every((seat) => seat === 1), true, 'bootstrap KDS must expose reconciled seatNumber');

  console.log(JSON.stringify({
    ok: true,
    contract: 'EDGE_OFFLINE_WAITER_RECONNECT_POSTGRESQL_V2',
    firstSyncSeat: 2,
    replayIdempotent: true,
    guestDecrease: '2->1',
    existingConsumptionMigrated: true,
    newConsumptionSeat: 1,
    receiptsSynced: 2,
    bootstrapBillingMode: true,
    bootstrapKdsSeatNumber: true
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
