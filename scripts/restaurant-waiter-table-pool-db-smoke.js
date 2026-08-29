'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const zones = require('../src/modules/restaurant/restaurant-zones.service');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

async function rejectsCode(promise, code) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, `Se esperaba error ${code}`);
  assert.equal(error.code, code);
  return error;
}

async function main() {
  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant?.id);

  const waiter = await prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'MESERO', activo: true } });
  assert.ok(waiter?.id, 'mesero demo faltante');

  const stamp = String(Date.now()).slice(-8);
  const otherWaiter = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      nombre: `Mesero otro ${stamp}`,
      email: `mesero-pool-${stamp}@example.test`,
      password: 'not-used',
      rol: 'MESERO',
      activo: true
    }
  });

  const zone = await zones.ensureDefaultZone(tenant.id);
  const sharedTable = await prisma.restaurantTable.create({
    data: {
      tenantId: tenant.id,
      zoneId: zone.id,
      code: `CP${stamp}`,
      name: `Mesa común ${stamp}`,
      seats: 4,
      posX: 30,
      posY: 30,
      assignedWaiterId: null,
      state: 'LIBRE',
      active: true
    }
  });
  const otherTable = await prisma.restaurantTable.create({
    data: {
      tenantId: tenant.id,
      zoneId: zone.id,
      code: `OT${stamp}`,
      name: `Mesa otro ${stamp}`,
      seats: 4,
      posX: 220,
      posY: 30,
      assignedWaiterId: otherWaiter.id,
      state: 'LIBRE',
      active: true
    }
  });

  const visibleTables = await restaurant.listTables(tenant.id, waiter);
  assert.ok(visibleTables.some((table) => table.id === sharedTable.id), 'una mesa sin mesero debe aparecer en la tablet');
  assert.equal(visibleTables.some((table) => table.id === otherTable.id), false, 'una mesa asignada a otro mesero debe permanecer aislada');

  const visibleZones = await zones.listZones(tenant.id, waiter);
  const visibleZone = visibleZones.find((row) => row.id === zone.id);
  assert.ok(visibleZone, 'la zona con mesa común debe ser visible');
  assert.ok(visibleZone.tableCount >= 7, 'la zona debe contar mesas propias y comunes');

  const opened = await restaurant.openTable(tenant.id, waiter, sharedTable.id, { billingMode:'CONJUNTA', guestCount:2 });
  assert.equal(opened.table.id, sharedTable.id);
  assert.equal(opened.session.openedByUserId, waiter.id);
  assert.equal(opened.session.state, 'ABIERTA');

  const menu = await restaurant.listMenu(tenant.id, { active:true });
  const sellable = menu.find((item) => item.product && (!item.requiresRecipe || item.recipeConfigured));
  assert.ok(sellable?.id, 'menú vendible faltante');

  const order = await restaurant.placeWaiterOrder(tenant.id, waiter, opened.session.id, {
    items: [{ menuItemId:sellable.id, quantity:1, notes:'QA panel completo tablet' }],
    notes: 'QA panel completo tablet',
    externalRequestId: `WAITER-POOL-${stamp}`
  });
  assert.equal(order.sessionId, opened.session.id);
  assert.equal(order.createdByUserId, waiter.id);
  assert.equal(order.source, 'MESERO');
  assert.ok(order.items.length >= 1);

  const orders = await restaurant.listOrders(tenant.id, { sessionId:opened.session.id }, waiter);
  assert.ok(orders.some((row) => row.id === order.id), 'el mesero debe ver el pedido de la mesa común');

  await rejectsCode(
    restaurant.openTable(tenant.id, waiter, otherTable.id, { billingMode:'CONJUNTA', guestCount:1 }),
    'RESTAURANT_WAITER_TABLE_FORBIDDEN'
  );

  console.log(JSON.stringify({
    ok:true,
    sharedPoolVisible:true,
    ownAssignedVisible:true,
    otherWaiterHidden:true,
    sharedTableOperational:true,
    orderCreated:true,
    waiter:waiter.nombre,
    sharedTable:sharedTable.code,
    orderId:order.id
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
