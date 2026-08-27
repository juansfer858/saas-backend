const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter, 'demo waiter must exist');

  const stamp = Date.now().toString().slice(-8);
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      code: `WV2-${stamp}`,
      name: `Mesa Mesero V2 ${stamp}`,
      seats: 6,
      assignedWaiterId: waiter.id
    }
  });
  const menu = await prisma.restaurantMenuItem.findMany({
    where: { tenantId: demo.tenantId, active: true },
    orderBy: { sortOrder: 'asc' },
    take: 3
  });
  assert.ok(menu.length >= 2, 'demo menu must contain products');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, {
    guestCount: 2,
    billingMode: 'INDIVIDUAL'
  });
  assert.equal(opened.session.billingMode, 'INDIVIDUAL');
  assert.equal(opened.session.guestCount, 2);

  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, 1);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[1].id, 2, 2);
  let draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.billingMode, 'INDIVIDUAL');
  assert.equal(draft.service.seats[0].items.length, 1);
  assert.equal(draft.service.seats[1].items.length, 1);

  const person2Item = draft.service.seats[1].items[0];
  await identity.updateOrderItemMeta(demo.tenantId, waiter, opened.session.id, person2Item.id, {
    notes: 'Sin cebolla'
  });
  draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.seats[1].items[0].notes, 'Sin cebolla');

  await assert.rejects(
    () => identity.updateTableServiceSetup(demo.tenantId, waiter, opened.session.id, { billingMode: 'CONJUNTA' }),
    (error) => error?.code === 'RESTAURANT_BILLING_MODE_LOCKED'
  );

  await identity.updateTableServiceSetup(demo.tenantId, waiter, opened.session.id, { guestCount: 3 });
  draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.guestCount, 3);
  assert.equal(draft.service.seats.length, 3);

  const sent = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(sent.state, 'ENVIADO');
  assert.ok(sent.commands.length >= 1);

  const prepared = await identity.prepareAccount(demo.tenantId, waiter, table.id);
  assert.ok(prepared.session.accountPreparedAt);
  assert.equal(prepared.session.cashierRequestedAt, null);

  const toCash = await identity.sendAccountToCash(demo.tenantId, waiter, table.id);
  assert.ok(toCash.session.cashierRequestedAt);
  let tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.id } });
  assert.equal(tableRow.state, 'CUENTA_PEDIDA');

  // A new round after asking for the bill reopens service, as in the existing restaurant workflow.
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, 3);
  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id);
  const sessionRow = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.id } });
  assert.equal(sessionRow.state, 'ABIERTA');
  assert.equal(sessionRow.accountPreparedAt, null);
  assert.equal(sessionRow.cashierRequestedAt, null);
  assert.equal(tableRow.state, 'OCUPADA');

  console.log('RESTAURANT WAITER V2 POSTGRESQL SMOKE OK');
  console.log(JSON.stringify({
    billingMode: 'INDIVIDUAL',
    persons: 3,
    itemByPerson: true,
    notes: true,
    modeLock: true,
    prepareAccount: true,
    sendToCash: true,
    newRoundReopensService: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
