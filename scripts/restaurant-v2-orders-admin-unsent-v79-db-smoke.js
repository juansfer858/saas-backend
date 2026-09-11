'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const base = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const adminDraft = require('../src/modules/restaurant/restaurant-v2-orders-admin-draft.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

function n(value) { return Number(value || 0); }

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter, 'el tenant demo debe tener mesero');

  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({
    data: { tenantId: demo.tenantId, name: `Pedidos V79 ${suffix}`, sortOrder: 998 }
  });
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `V79-${suffix}`,
      name: `Mesa Pedidos V79 ${suffix}`,
      seats: 4,
      assignedWaiterId: waiter.id
    }
  });

  const menu = (await base.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  assert.ok(menu.length, 'el tenant demo debe tener carta operativa');

  const opened = await base.openTable(demo.tenantId, waiter, table.id, { guestCount: 2 }, V2_OPTIONS);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 2, null, V2_OPTIONS);

  const draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  assert.equal(draft.order.state, 'BORRADOR');
  assert.equal(draft.order.source, 'MESERO');
  assert.equal(draft.order.items.length, 1);
  const item = draft.order.items[0];

  const saleBefore = await prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } });
  const detailBefore = await prisma.detalleComprobante.findUnique({ where: { id: item.saleDetailId } });
  assert.ok(detailBefore);

  const removed = await adminDraft.removeUnsentWaiterDraftItem(demo.tenantId, opened.session.id, item.id);
  assert.equal(removed.removed, true);
  assert.equal(removed.itemId, item.id);

  const [deletedItem, deletedDetail, saleAfter, pendingCount] = await Promise.all([
    prisma.restaurantOrderItem.findUnique({ where: { id: item.id } }),
    prisma.detalleComprobante.findUnique({ where: { id: item.saleDetailId } }),
    prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } }),
    prisma.restaurantOrderItem.count({ where: { tenantId: demo.tenantId, orderId: draft.order.id } })
  ]);
  assert.equal(deletedItem, null, 'la línea borrador debe desaparecer');
  assert.equal(deletedDetail, null, 'la línea comercial asociada debe desaparecer');
  assert.equal(pendingCount, 0, 'un borrador vacío ya no debe bloquear el cierre por líneas pendientes');
  assert.equal(n(saleAfter.total), n(saleBefore.total) - n(detailBefore.totalLinea));
  assert.equal(n(saleAfter.subtotal), n(saleBefore.subtotal) - n(detailBefore.subtotalLinea));
  assert.equal(n(saleAfter.ivaTotal), n(saleBefore.ivaTotal) - n(detailBefore.ivaValor));
  assert.equal(n(saleAfter.impoconsumoTotal), n(saleBefore.impoconsumoTotal) - n(detailBefore.impoconsumoValor));

  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, null, V2_OPTIONS);
  const secondDraft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  const sentCandidate = secondDraft.order.items[0];
  assert.ok(sentCandidate);
  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);

  let sentBlocked = false;
  try {
    await adminDraft.removeUnsentWaiterDraftItem(demo.tenantId, opened.session.id, sentCandidate.id);
  } catch (error) {
    sentBlocked = error?.code === 'RESTAURANT_DRAFT_ITEM_ALREADY_SENT';
  }
  assert.equal(sentBlocked, true, 'una línea ya enviada debe ser intocable desde Pedidos');
  assert.ok(await prisma.restaurantOrderItem.findUnique({ where: { id: sentCandidate.id } }), 'la línea enviada debe conservarse');

  console.log(JSON.stringify({
    ok: true,
    module: 'RESTAURANT_V2_ORDERS_ADMIN_UNSENT_V79',
    adminCanRemoveWaiterDraft: true,
    saleRecalculated: true,
    emptyDraftDoesNotContainBlockingLines: true,
    sentItemProtected: true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
