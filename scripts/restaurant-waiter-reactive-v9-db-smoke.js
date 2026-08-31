'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const flex = require('../src/modules/restaurant/restaurant-waiter-service-flex-v9');
const { waiterRuntimeV10 } = require('../src/modules/restaurant/restaurant-waiter-device.public.routes');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

async function main() {
  assert.equal(flex.MARKER, 'VANTIX_WAITER_FLEXIBLE_BILLING_V10');
  assert.equal(flex.LEGACY_MARKER, 'VANTIX_WAITER_FLEXIBLE_BILLING_V9');
  const reactive = read('src/web/restaurant-waiter-reactive-v9.js');
  const publicRoutes = read('src/modules/restaurant/restaurant-waiter-device.public.routes.js');
  const runtimeBase = read('src/web/restaurant-waiter-runtime-v7.js');
  const runtime = waiterRuntimeV10(runtimeBase);
  const sw = read('src/web/restaurant-waiter-sw.js');
  assert.match(reactive, /VANTIX_WAITER_REACTIVE_SERVICE_V10/);
  assert.match(reactive, /VANTIX_WAITER_REACTIVE_SERVICE_V9/);
  assert.match(reactive, /queueMicrotask\(\(\) => paintBilling\(desired\)\)/);
  assert.match(reactive, /queueMicrotask\(\(\) => paintGuestCount\(desired\)\)/);
  assert.match(reactive, /remove-person/);
  assert.match(reactive, /repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(reactive, /pointerEvents = locked/);
  assert.match(reactive, /\/servicio\$/);
  assert.match(publicRoutes, /waiterRuntimeV10/);
  assert.match(publicRoutes, /v9-reactive-adaptive-v10-flexible-persons/);
  assert.match(publicRoutes, /v9-reactive-persistent-v10-flexible-persons/);
  assert.match(publicRoutes, /restaurant-waiter-service-flex-v9/);
  assert.match(runtime, /data-action="remove-person"/);
  assert.match(runtime, /Quitar última persona/);
  assert.match(runtime, /Persona \$\{current\} eliminada/);
  new Function(runtime);
  assert.match(sw, /vantixgc-waiter-shell-v9-v10/);
  assert.match(sw, /waiter-runtime-v8-v10/);

  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter?.id);
  const stamp = Date.now().toString().slice(-8);
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name:`Modo flexible ${stamp}`, sortOrder:997 } });
  const table = await prisma.restaurantTable.create({
    data: { tenantId:demo.tenantId, zoneId:zone.id, code:`RF-${stamp}`, name:`Mesa Reactiva ${stamp}`, seats:8, assignedWaiterId:waiter.id }
  });
  const menu = await prisma.restaurantMenuItem.findMany({ where:{ tenantId:demo.tenantId, active:true }, orderBy:{ sortOrder:'asc' }, take:2 });
  assert.ok(menu.length >= 2, 'se requieren al menos dos productos de menú');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2, billingMode:'CONJUNTA' });
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, null);

  let result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'INDIVIDUAL' });
  assert.equal(result.service.billingMode, 'INDIVIDUAL');
  let items = await prisma.restaurantOrderItem.findMany({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id } } });
  assert.ok(items.length >= 1);
  assert.equal(items.every((item) => Number(item.seatNumber) === 1), true, 'consumos conjuntos pasan de forma segura a Persona 1');

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { guestCount:3 });
  assert.equal(result.service.guestCount, 3);
  assert.equal(result.service.seats.length, 3);

  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[1].id, 1, 3);
  let person3 = await prisma.restaurantOrderItem.findFirst({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id }, seatNumber:3 } });
  assert.ok(person3?.id, 'Persona 3 debe tener un consumo antes de eliminarla');

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { guestCount:2 });
  assert.equal(result.service.guestCount, 2);
  assert.equal(result.service.seats.length, 2);
  person3 = await prisma.restaurantOrderItem.findFirst({ where:{ id:person3.id } });
  assert.equal(Number(person3.seatNumber), 2, 'al quitar Persona 3 sus consumos deben fusionarse en Persona 2');

  result = await flex.updateTableServiceSetupFlexible(demo.tenantId, waiter, opened.session.id, { billingMode:'CONJUNTA' });
  assert.equal(result.service.billingMode, 'CONJUNTA');
  items = await prisma.restaurantOrderItem.findMany({ where:{ tenantId:demo.tenantId, order:{ sessionId:opened.session.id } } });
  assert.equal(items.every((item) => item.seatNumber == null), true, 'cuenta conjunta elimina asignación por persona');
  assert.equal(result.service.guestCount, 2, 'cambiar a conjunta conserva el número real de comensales');

  console.log(JSON.stringify({
    ok:true,
    waiter:'V10_FLEXIBLE_PERSONS',
    visualImmediate:true,
    microtaskPaint:true,
    billingSwitchWithConsumption:true,
    jointToIndividualMigratesToSeat1:true,
    individualToJointClearsSeats:true,
    addPersonFlexible:true,
    removePersonFlexible:true,
    removedSeatItemsMergeIntoLastSeat:true,
    physicalGuestCountPreservedWhenJoint:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
