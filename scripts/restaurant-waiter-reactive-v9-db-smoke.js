'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const flex = require('../src/modules/restaurant/restaurant-waiter-service-flex-v9');
const { waiterRuntimeV14 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

async function main() {
  assert.equal(flex.MARKER, 'VANTIX_WAITER_FLEXIBLE_BILLING_V10');
  const publicRoutes = read('src/modules/restaurant/restaurant-waiter-device.public.routes.js');
  const runtime = waiterRuntimeV14(read('src/web/restaurant-waiter-runtime-v7.js'));
  const sw = read('src/web/restaurant-waiter-sw.js');

  assert.match(runtime, /VANTIX_WAITER_NO_REBOUND_V11/);
  assert.match(runtime, /VANTIX_WAITER_ORDER_REVIEW_HARD_GATE_V14/);
  assert.match(runtime, /function applyServiceLocally/);
  assert.match(runtime, /const mutationEpoch = \+\+S\.detailsEpoch/);
  assert.match(runtime, /S\.mutationCount \|\| S\.qtyJobs\.size/);
  assert.match(runtime, /data-action="remove-person"/);
  assert.match(runtime, /singleStateOwner:true/);
  assert.match(runtime, /hardReviewGate:true/);
  assert.match(runtime, /data-action="confirm-send-draft"/);
  assert.doesNotMatch(runtime, /data-action="send-draft"/);
  assert.doesNotMatch(runtime, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
  assert.match(publicRoutes, /waiterRuntimeV14/);
  assert.match(publicRoutes, /v14-review-hard-gate/);
  assert.doesNotMatch(publicRoutes, /waiterReactiveV9Script/);
  assert.match(sw, /vantixgc-waiter-shell-v14-review-hard-gate/);
  assert.match(sw, /waiter-runtime-v14/);
  new Function(runtime);

  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter?.id);
  const stamp = Date.now().toString().slice(-8);
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name:`Modo estable ${stamp}`, sortOrder:997 } });
  const table = await prisma.restaurantTable.create({
    data: { tenantId:demo.tenantId, zoneId:zone.id, code:`NR-${stamp}`, name:`Mesa Sin Rebote ${stamp}`, seats:8, assignedWaiterId:waiter.id }
  });
  const menu = await prisma.restaurantMenuItem.findMany({ where:{ tenantId:demo.tenantId, active:true }, orderBy:{ sortOrder:'asc' }, take:2 });
  assert.ok(menu.length >= 2, 'se requieren al menos dos productos de menú');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2, billingMode:'CONJUNTA' });
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, null);

  let result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'INDIVIDUAL' });
  assert.equal(result.service.billingMode, 'INDIVIDUAL');
  let persisted = await prisma.restaurantTableSession.findUnique({ where:{ id:opened.session.id } });
  assert.equal(persisted.billingMode, 'INDIVIDUAL');

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { guestCount:3 });
  assert.equal(result.service.guestCount, 3);
  persisted = await prisma.restaurantTableSession.findUnique({ where:{ id:opened.session.id } });
  assert.equal(persisted.guestCount, 3);

  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[1].id, 1, 3);
  let person3 = await prisma.restaurantOrderItem.findFirst({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id }, seatNumber:3 } });
  assert.ok(person3?.id);

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { guestCount:2 });
  assert.equal(result.service.guestCount, 2);
  person3 = await prisma.restaurantOrderItem.findUnique({ where:{ id:person3.id } });
  assert.equal(Number(person3.seatNumber), 2);

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'CONJUNTA' });
  assert.equal(result.service.billingMode, 'CONJUNTA');
  const items = await prisma.restaurantOrderItem.findMany({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id } } });
  assert.equal(items.every((item) => item.seatNumber == null), true);

  console.log(JSON.stringify({
    ok:true,
    waiter:'V11_NO_REBOUND_WITH_V14_HARD_GATE',
    backendAckMatchesSelection:true,
    jointToIndividual:true,
    addPerson:true,
    removePerson:true,
    removedSeatConsumptionMerged:true,
    individualToJoint:true,
    hardReviewGate:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
