'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const { prisma }=require('../src/config/prisma');
const { ensureRestaurantDemoTenant }=require('./ensure-restaurant-demo-tenant');
const base=require('../src/modules/restaurant/restaurant.service');
const identity=require('../src/modules/restaurant/restaurant-identity.service');
const { V2_OPTIONS }=require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main(){
  const routeSource=fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.routes.js','utf8');
  const uiSource=fs.readFileSync('src/web/restaurant-v2-orders.js','utf8');
  const coreSource=fs.readFileSync('src/routes/core.routes.js','utf8');
  assert.match(routeSource,/sharedFloor:true,optionalSeat:true/);
  assert.doesNotMatch(routeSource,/billingMode\s*:/);
  assert.match(uiSource,/REVISAR PEDIDO/);
  assert.match(uiSource,/CONFIRMAR Y ENVIAR A COCINA \/ BARRA/);
  assert.doesNotMatch(uiSource,/MutationObserver|setInterval|\.replace\(/);
  assert.match(coreSource,/restaurantV2OrdersRouter/);

  const demo=await ensureRestaurantDemoTenant();
  const waiter=await prisma.user.findUnique({where:{id:demo.users.MESERO}});
  const suffix=crypto.randomBytes(4).toString('hex');
  const otherWaiter=await prisma.user.create({data:{tenantId:demo.tenantId,nombre:`Mesero refuerzo ${suffix}`,email:`refuerzo-${suffix}@example.test`,password:'not-used',rol:'MESERO',activo:true}});
  const zone=await prisma.restaurantZone.create({data:{tenantId:demo.tenantId,name:`P3 ${suffix}`,sortOrder:998}});
  const table=await prisma.restaurantTable.create({data:{tenantId:demo.tenantId,zoneId:zone.id,code:`P3-${suffix}`,name:`Mesa P3 ${suffix}`,seats:4,assignedWaiterId:otherWaiter.id}});
  let sessionId=null,saleId=null;
  try{
    const v1Tables=await identity.listTablesLive(demo.tenantId,waiter);
    assert.equal(v1Tables.some(x=>x.id===table.id),false,'V1 debe conservar el alcance original del mesero');
    const v2Tables=await identity.listTablesLive(demo.tenantId,waiter,V2_OPTIONS);
    assert.equal(v2Tables.some(x=>x.id===table.id),true,'V2 permite refuerzo de piso compartido');

    let v1Denied=false;
    try{await base.openTable(demo.tenantId,waiter,table.id,{guestCount:1});}catch(error){v1Denied=error.code==='RESTAURANT_WAITER_TABLE_FORBIDDEN'}
    assert.equal(v1Denied,true,'V1 no debe cambiar silenciosamente su seguridad');

    const opened=await base.openTable(demo.tenantId,waiter,table.id,{guestCount:1},V2_OPTIONS);
    sessionId=opened.session.id;saleId=opened.sale.id;
    assert.equal(opened.session.billingMode,'CONJUNTA','V2 abre servicio sin preguntar forma de división');

    await identity.updateTableServiceSetup(demo.tenantId,waiter,sessionId,{guestCount:2},V2_OPTIONS);
    const menu=await base.listMenu(demo.tenantId);
    const usable=menu.filter(x=>!x.warning&&x.product).slice(0,2);
    assert.equal(usable.length,2);

    await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,usable[0].id,1,1,V2_OPTIONS);
    await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,usable[1].id,2,null,V2_OPTIONS);
    let draft=await identity.getWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.ok(draft.order?.id);
    assert.equal(draft.service.seats[0].items.length,1,'producto opcionalmente asignado a Persona 1');
    assert.equal(draft.service.unassigned.items.length,1,'producto puede seguir perteneciendo a la mesa');
    assert.equal(draft.service.billingMode,'CONJUNTA');
    assert.equal(draft.order.state,'BORRADOR','agregar productos no puede enviar a cocina');
    assert.equal(await prisma.restaurantCommand.count({where:{tenantId:demo.tenantId,orderId:draft.order.id}}),0,'no hay comanda antes de confirmar');

    const first=draft.order.items.find(x=>x.menuItemId===usable[0].id);
    await identity.updateOrderItemMeta(demo.tenantId,waiter,sessionId,first.id,{notes:'sin cebolla'},V2_OPTIONS);
    draft=await identity.getWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.equal(draft.order.items.find(x=>x.id===first.id).notes,'sin cebolla');

    const sent=await identity.sendWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.equal(sent.state,'ENVIADO');
    assert.ok(sent.commands.length>=1,'confirmar crea comandas reales');
    assert.ok(Number((await prisma.comprobanteComercial.findUnique({where:{id:saleId}})).total)>0,'venta borrador conserva total real');

    console.log(JSON.stringify({ok:true,module:'PEDIDOS_V2_P3',v1IsolationPreserved:true,sharedFloorOptIn:true,noBillingQuestion:true,optionalPersons:true,reviewBeforeSend:true,commandsOnlyAfterConfirm:true}));
  }finally{
    if(sessionId){
      const orderIds=(await prisma.restaurantOrder.findMany({where:{tenantId:demo.tenantId,sessionId},select:{id:true}})).map(x=>x.id);
      if(orderIds.length){await prisma.restaurantCommand.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});await prisma.restaurantOrderItem.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});await prisma.restaurantOrder.deleteMany({where:{tenantId:demo.tenantId,id:{in:orderIds}}});}
      await prisma.restaurantQrVisitDevice.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantSessionPayment.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantFiscalDocument.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantTableSession.deleteMany({where:{tenantId:demo.tenantId,id:sessionId}});
    }
    if(saleId){await prisma.detalleComprobante.deleteMany({where:{tenantId:demo.tenantId,comprobanteId:saleId}});await prisma.comprobanteComercial.deleteMany({where:{tenantId:demo.tenantId,id:saleId}});}
    await prisma.restaurantTable.deleteMany({where:{tenantId:demo.tenantId,id:table.id}});
    await prisma.restaurantZone.deleteMany({where:{tenantId:demo.tenantId,id:zone.id}});
    await prisma.user.deleteMany({where:{tenantId:demo.tenantId,id:otherWaiter.id}});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
