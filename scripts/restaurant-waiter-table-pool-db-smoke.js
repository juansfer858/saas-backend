'use strict';

const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const zones = require('../src/modules/restaurant/restaurant-zones.service');
const {
  RESTAURANT_SHARED_WAITER_ROLE,
  runtimeUserForRequest
} = require('../src/middleware/auth-middleware');
const { ensureRestaurantDemoTenant, SUBDOMAIN } = require('./ensure-restaurant-demo-tenant');

async function main() {
  await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  assert.ok(tenant?.id);

  const waiter = await prisma.user.findFirst({ where: { tenantId: tenant.id, rol: 'MESERO', activo: true } });
  assert.ok(waiter?.id, 'mesero demo faltante');

  const floorWaiter = runtimeUserForRequest({ originalUrl:'/api/v1/restaurante/mesas' }, waiter);
  assert.equal(floorWaiter.id, waiter.id);
  assert.equal(floorWaiter.rol, RESTAURANT_SHARED_WAITER_ROLE, 'el actor operacional debe usar piso compartido');
  assert.equal(floorWaiter.securityRole, 'MESERO', 'la identidad de seguridad debe seguir siendo MESERO');
  const uiWaiter = runtimeUserForRequest({ originalUrl:'/api/v1/restaurante/ui-context' }, waiter);
  assert.equal(uiWaiter.rol, 'MESERO', 'la UI debe seguir presentando el rol real MESERO');

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
      name: `Mesa refuerzo ${stamp}`,
      seats: 4,
      posX: 220,
      posY: 30,
      assignedWaiterId: otherWaiter.id,
      state: 'LIBRE',
      active: true
    }
  });

  const visibleTables = await restaurant.listTables(tenant.id, floorWaiter);
  assert.ok(visibleTables.some((table) => table.id === sharedTable.id), 'una mesa libre debe aparecer a cualquier mesero');
  assert.ok(visibleTables.some((table) => table.id === otherTable.id), 'una mesa marcada con otro mesero también debe aparecer para permitir refuerzos');

  const visibleZones = await zones.listZones(tenant.id, floorWaiter);
  const visibleZone = visibleZones.find((row) => row.id === zone.id);
  assert.ok(visibleZone, 'todas las zonas deben ser visibles para el mesero');
  assert.ok(visibleZone.tableCount >= 8, 'la zona debe contar todas sus mesas, sin filtrar por mesero');

  const opened = await restaurant.openTable(tenant.id, floorWaiter, sharedTable.id, { billingMode:'CONJUNTA', guestCount:2 });
  assert.equal(opened.table.id, sharedTable.id);
  assert.equal(opened.session.openedByUserId, waiter.id, 'la atención debe quedar atribuida al mesero que abrió la mesa');
  assert.equal(opened.session.state, 'ABIERTA');

  const menu = await restaurant.listMenu(tenant.id, { active:true });
  const sellable = menu.find((item) => item.product && (!item.requiresRecipe || item.recipeConfigured));
  assert.ok(sellable?.id, 'menú vendible faltante');

  const order = await restaurant.placeWaiterOrder(tenant.id, floorWaiter, opened.session.id, {
    items: [{ menuItemId:sellable.id, quantity:1, notes:'QA piso compartido tablet' }],
    notes: 'QA piso compartido tablet',
    externalRequestId: `WAITER-SHARED-${stamp}`
  });
  assert.equal(order.sessionId, opened.session.id);
  assert.equal(order.createdByUserId, waiter.id, 'cada pedido debe conservar qué mesero lo creó');
  assert.equal(order.source, 'MESERO');
  assert.ok(order.items.length >= 1);

  const draft = await identity.getWaiterDraft(tenant.id, floorWaiter, opened.session.id);
  assert.equal(draft.session.id, opened.session.id, 'el panel completo debe poder operar la sesión sin barrera de asignación');

  const orders = await restaurant.listOrders(tenant.id, { sessionId:opened.session.id }, floorWaiter);
  assert.ok(orders.some((row) => row.id === order.id), 'el mesero debe ver el pedido de la mesa atendida');

  const reinforced = await restaurant.openTable(tenant.id, floorWaiter, otherTable.id, { billingMode:'CONJUNTA', guestCount:1 });
  assert.equal(reinforced.table.id, otherTable.id, 'un mesero debe poder entrar a una mesa previamente marcada con otro mesero');
  assert.equal(reinforced.session.openedByUserId, waiter.id, 'el refuerzo debe quedar atribuido al mesero que realmente atendió');
  const reinforcedDraft = await identity.getWaiterDraft(tenant.id, floorWaiter, reinforced.session.id);
  assert.equal(reinforcedDraft.session.id, reinforced.session.id, 'el refuerzo debe poder operar la mesa completa');

  console.log(JSON.stringify({
    ok:true,
    allTablesVisible:true,
    allZonesVisible:true,
    assignedTableAccessible:true,
    reinforcementAllowed:true,
    sessionAttributionByWaiter:true,
    orderAttributionByWaiter:true,
    securityRolePreserved:true,
    uiRolePreserved:true,
    waiter:waiter.nombre,
    sharedTable:sharedTable.code,
    reinforcedTable:otherTable.code,
    orderId:order.id
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
