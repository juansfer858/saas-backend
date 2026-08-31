'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const flex = require('../src/modules/restaurant/restaurant-waiter-service-flex-v9');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

async function main() {
  assert.equal(flex.MARKER, 'VANTIX_WAITER_FLEXIBLE_BILLING_V9');
  const reactive = read('src/web/restaurant-waiter-reactive-v9.js');
  const publicRoutes = read('src/modules/restaurant/restaurant-waiter-device.public.routes.js');
  const sw = read('src/web/restaurant-waiter-sw.js');
  assert.match(reactive, /VANTIX_WAITER_REACTIVE_SERVICE_V9/);
  assert.match(reactive, /paintBilling\(desired\)/);
  assert.match(reactive, /pointerEvents = locked/);
  assert.match(reactive, /\/servicio\$/);
  assert.match(publicRoutes, /restaurant-waiter-reactive-v9\.js/);
  assert.match(publicRoutes, /v9-reactive-adaptive/);
  assert.match(publicRoutes, /v9-reactive-persistent/);
  assert.match(publicRoutes, /restaurant-waiter-service-flex-v9/);
  assert.match(sw, /vantixgc-waiter-shell-v9/);

  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter?.id);
  const stamp = Date.now().toString().slice(-8);
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name:`Modo flexible ${stamp}`, sortOrder:997 } });
  const table = await prisma.restaurantTable.create({
    data: { tenantId:demo.tenantId, zoneId:zone.id, code:`RF-${stamp}`, name:`Mesa Reactiva ${stamp}`, seats:6, assignedWaiterId:waiter.id }
  });
  const menu = await prisma.restaurantMenuItem.findFirst({ where:{ tenantId:demo.tenantId, active:true }, orderBy:{ sortOrder:'asc' } });
  assert.ok(menu?.id, 'se requiere al menos un producto de menú');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2, billingMode:'CONJUNTA' });
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu.id, 1, null);

  let result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'INDIVIDUAL' });
  assert.equal(result.service.billingMode, 'INDIVIDUAL');
  let items = await prisma.restaurantOrderItem.findMany({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id } } });
  assert.ok(items.length >= 1);
  assert.equal(items.every((item) => Number(item.seatNumber) === 1), true, 'consumos conjuntos pasan de forma segura a Persona 1');

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { guestCount:3 });
  assert.equal(result.service.guestCount, 3);
  assert.equal(result.service.seats.length, 3);

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'CONJUNTA' });
  assert.equal(result.service.billingMode, 'CONJUNTA');
  items = await prisma.restaurantOrderItem.findMany({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id } } });
  assert.equal(items.every((item) => item.seatNumber == null), true, 'cuenta conjunta elimina asignación por persona');

  console.log(JSON.stringify({
    ok:true,
    waiter:'V9_REACTIVE_SERVICE',
    visualImmediate:true,
    billingSwitchWithConsumption:true,
    jointToIndividualMigratesToSeat1:true,
    individualToJointClearsSeats:true,
    addPersonFlexible:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
