'use strict';
const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const kds = require('../src/modules/restaurant/restaurant-v2-kds.service');
const live = require('../src/modules/restaurant/restaurant-table-live-detail-v67.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main() {
  const cancelled = [{state:'CANCELADO',items:[{id:'historical'}],commands:[{state:'CANCELADA'}]}];
  const sale = {estado:'BORRADOR',total:0};
  assert.equal(live.emptyTableFacts(sale,cancelled,0,0).empty,true);
  for (const [payments,fiscal,details] of [[1,0,0],[0,1,0],[0,0,1]]) {
    assert.equal(live.emptyTableFacts(sale,cancelled,payments,fiscal,details).empty,false);
  }
  assert.equal(live.emptyTableFacts(sale,[{...cancelled[0],commands:[{state:'PENDIENTE'}]}],0,0).empty,false);
  assert.equal(live.emptyTableFacts({...sale,estado:'PAGADO_TOTAL'},cancelled,0,0).empty,false);
  assert.equal(live.emptyTableFacts(sale,[...cancelled,{state:'BORRADOR',items:[{lineTotal:0}]}],0,0).empty,false);

  const demo = await ensureRestaurantDemoTenant();
  const [admin,waiter,cook,menu] = await Promise.all([
    prisma.user.findUnique({where:{id:demo.users.ADMIN}}),
    prisma.user.findUnique({where:{id:demo.users.MESERO}}),
    prisma.user.findUnique({where:{id:demo.users.COCINA}}),
    prisma.restaurantMenuItem.findFirst({where:{tenantId:demo.tenantId,active:true,station:'BARRA'},orderBy:{sortOrder:'asc'}})
  ]);
  assert.ok(admin && waiter && cook && menu);
  const table = await restaurant.createTable(demo.tenantId,{code:'C108-'+Date.now(),name:'CI cancelaciones sin consumo',seats:4});
  const opened = await restaurant.openTable(demo.tenantId,waiter,table.id,{guestCount:1},V2_OPTIONS);
  const sessionId = opened.session.id;
  await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,menu.id,1,null,V2_OPTIONS);
  await identity.sendWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
  const order = await prisma.restaurantOrder.findFirst({where:{tenantId:demo.tenantId,sessionId,state:'ENVIADO'},include:{items:true,commands:true}});
  assert.ok(order);
  await assert.rejects(live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id),e=>e.code==='RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS');
  const reason = 'Pedido de prueba cancelado antes de preparación';
  await kds.cancelOrder(demo.tenantId,cook,order.id,{reason});
  const device = await prisma.restaurantQrVisitDevice.create({data:{tenantId:demo.tenantId,sessionId,tokenHash:'v108-'+sessionId,seatNumber:1}});
  const detail = await live.liveDetail(demo.tenantId,admin,table.id);
  assert.equal(detail.canCloseEmptyFromControlCenter,true);
  assert.equal(detail.emptyCloseInfo.cancelledHistory,true);
  assert.equal(Number(detail.summary.total),0);
  assert.equal((await live.liveDetail(demo.tenantId,waiter,table.id)).canCloseEmptyFromControlCenter,false);
  await assert.rejects(live.closeEmptyFromControlCenter(demo.tenantId,waiter,table.id),e=>e.code==='RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_FORBIDDEN');
  // A new draft alongside the cancelled history must still block closure.
  await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,menu.id,1,null,V2_OPTIONS);
  await assert.rejects(live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id),e=>e.code==='RESTAURANT_CONTROL_CENTER_EMPTY_CLOSE_HAS_PRODUCTS');
  await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,menu.id,0,null,V2_OPTIONS);
  const result = await live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id);
  assert.equal(result.closed,true);
  assert.equal(result.historyPreserved,true);
  assert.equal(result.table.state,'LIBRE');
  const archived = await prisma.restaurantTableSession.findUnique({where:{id:sessionId}});
  assert.equal(archived.state,'CANCELADA');
  assert.equal(archived.closedByUserId,admin.id);
  assert.ok(archived.closedAt);
  const archivedSale = await prisma.comprobanteComercial.findUnique({where:{id:archived.saleId}});
  assert.equal(archivedSale.estado,'ANULADO');
  assert.equal(Number(archivedSale.total),0);
  const kept = await prisma.restaurantOrder.findUnique({where:{id:order.id},include:{items:true,commands:true}});
  assert.equal(kept.state,'CANCELADO');
  assert.deepEqual(kept.items.map(i=>i.id).sort(),order.items.map(i=>i.id).sort());
  assert.deepEqual(kept.commands.map(i=>i.id).sort(),order.commands.map(i=>i.id).sort());
  assert.ok(kept.commands.every(c=>c.state==='CANCELADA'));
  const audit = await prisma.auditoriaContable.findFirst({where:{tenantId:demo.tenantId,entidadId:order.id,accion:'RESTAURANT_ORDER_CANCELLED_KDS'}});
  assert.equal(audit.metadata.reason,reason);
  assert.equal(await prisma.auditoriaContable.count({where:{tenantId:demo.tenantId,entidadId:sessionId,accion:'RESTAURANT_ZERO_CONSUMPTION_VISIT_CLOSED'}}),1);
  assert.ok((await prisma.restaurantQrVisitDevice.findUnique({where:{id:device.id}})).revokedAt);
  assert.equal(await prisma.restaurantSessionPayment.count({where:{tenantId:demo.tenantId,sessionId}}),0);
  assert.equal(await prisma.restaurantFiscalDocument.count({where:{tenantId:demo.tenantId,sessionId}}),0);
  assert.equal((await live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id)).alreadyFree,true);
  await assert.rejects(identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,menu.id,1,null,V2_OPTIONS));
  const reopened = await restaurant.openTable(demo.tenantId,waiter,table.id,{guestCount:1},V2_OPTIONS);
  assert.notEqual(reopened.session.id,sessionId);
  const fresh = await live.liveDetail(demo.tenantId,admin,table.id);
  assert.equal(fresh.items.length,0);
  await live.closeEmptyFromControlCenter(demo.tenantId,admin,table.id);
  assert.ok(await prisma.restaurantOrder.findUnique({where:{id:order.id}}));
  console.log('V108 cancelled visit closure: history retained, table reusable, active consumption protected');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
