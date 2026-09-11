'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const { prisma }=require('../src/config/prisma');
const { ensureRestaurantDemoTenant }=require('./ensure-restaurant-demo-tenant');
const base=require('../src/modules/restaurant/restaurant.service');
const identity=require('../src/modules/restaurant/restaurant-identity.service');
const { V2_OPTIONS,listTablesV2 }=require('../src/modules/restaurant/restaurant-v2-orders.routes');

function between(source,start,end){const a=source.indexOf(start);const b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`No se pudo aislar ${start}`);return source.slice(a,b)}

async function main(){
  const routeSource=fs.readFileSync('src/modules/restaurant/restaurant-v2-orders.routes.js','utf8');
  const uiSource=fs.readFileSync('src/web/restaurant-v2-orders.js','utf8');
  const htmlSource=fs.readFileSync('src/web/restaurant-v2-orders.html','utf8');
  const coreSource=fs.readFileSync('src/routes/core.routes.js','utf8');
  assert.match(routeSource,/sharedFloor:true,optionalSeat:true/);
  assert.doesNotMatch(routeSource,/billingMode\s*:/);
  assert.doesNotMatch(routeSource,/actualizadoEn/,'Pedidos V2 no puede consultar campos inexistentes de ComprobanteComercial');
  assert.match(routeSource,/listTablesV2/);
  assert.match(routeSource,/creadoEn:true/);
  assert.match(htmlSource,/REVISAR PEDIDO/);
  assert.match(htmlSource,/CONFIRMAR Y ENVIAR A COCINA \/ BARRA/);
  assert.match(uiSource,/\/pedido\/enviar/);
  assert.match(uiSource,/VANTIX_RESTAURANT_V2_WAITER_FAST_MUTATIONS_V81/);
  assert.match(uiSource,/function mergeDraftResult/);
  assert.match(uiSource,/function mergeItemResult/);
  assert.match(uiSource,/ENVIANDO PEDIDO/);
  const setProductSource=between(uiSource,'async function setProduct','async function changeQtyByItem');
  const patchItemSource=between(uiSource,'async function patchItem','async function changePeople');
  const changePeopleSource=between(uiSource,'async function changePeople','function openReview');
  const confirmSendSource=between(uiSource,'async function confirmSend','function realtimeRelevant');
  assert.match(setProductSource,/mergeDraftResult\(result\)/,'cantidad debe adoptar la respuesta del PUT sin GET redundante');
  assert.doesNotMatch(setProductSource,/loadDraft|loadBase/,'cantidad no debe recargar toda la PWA');
  assert.match(patchItemSource,/mergeItemResult\(result\)/,'nota/persona debe adoptar la respuesta del PATCH');
  assert.doesNotMatch(patchItemSource,/loadDraft|loadBase/,'nota/persona no debe disparar GET redundante');
  assert.match(changePeopleSource,/result\?\.session/,'personas debe adoptar sesión devuelta por backend');
  assert.doesNotMatch(changePeopleSource,/loadDraft|loadBase/,'cambiar personas no debe recargar carta/contexto');
  assert.match(confirmSendSource,/await loadDraft\(\)/,'después de enviar sólo se refresca la sesión seleccionada');
  assert.doesNotMatch(confirmSendSource,/loadBase\(\)/,'enviar pedido no debe recargar contexto, todas las mesas y carta');
  assert.doesNotMatch(uiSource,/MutationObserver|setInterval|originalSend|res\.send\s*=/);
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
    const v2Tables=await listTablesV2(demo.tenantId,waiter);
    assert.equal(v2Tables.some(x=>x.id===table.id),true,'V2 permite refuerzo de piso compartido');

    let v1Denied=false;
    try{await base.openTable(demo.tenantId,waiter,table.id,{guestCount:1});}catch(error){v1Denied=error.code==='RESTAURANT_WAITER_TABLE_FORBIDDEN'}
    assert.equal(v1Denied,true,'V1 no debe cambiar silenciosamente su seguridad');

    const opened=await base.openTable(demo.tenantId,waiter,table.id,{guestCount:1},V2_OPTIONS);
    sessionId=opened.session.id;saleId=opened.sale.id;
    assert.equal(opened.session.billingMode,'CONJUNTA','V2 abre servicio sin preguntar forma de división');

    // Regression real observada en piloto: /v2/mesas debe poder decorar una mesa OCUPADA
    // con su venta activa. Antes intentaba seleccionar ComprobanteComercial.actualizadoEn,
    // campo inexistente en Prisma, por lo que el endpoint devolvía 500 sólo con sesiones abiertas.
    const occupiedTables=await listTablesV2(demo.tenantId,waiter);
    const occupied=occupiedTables.find(x=>x.id===table.id);
    assert.ok(occupied?.activeSession,'la mesa ocupada debe seguir visible en Pedidos V2');
    assert.equal(occupied.activeSession.id,sessionId);
    assert.equal(occupied.activeSession.sale?.id,saleId,'la venta activa debe decorarse sin 500');
    assert.equal(occupied.activeSession.sale?.numero,opened.sale.numero);
    assert.ok(occupied.activeSession.sale?.creadoEn instanceof Date,'la fecha real disponible debe venir de creadoEn');

    const peopleResult=await identity.updateTableServiceSetup(demo.tenantId,waiter,sessionId,{guestCount:2},V2_OPTIONS);
    assert.equal(Number(peopleResult.session.guestCount),2,'PATCH personas devuelve sesión utilizable sin recarga global');
    assert.equal(Number(peopleResult.service.guestCount),2,'PATCH personas devuelve resumen utilizable sin recarga global');
    const menu=await base.listMenu(demo.tenantId);
    const usable=menu.filter(x=>!x.warning&&x.product).slice(0,2);
    assert.equal(usable.length,2);

    const firstSet=await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,usable[0].id,1,1,V2_OPTIONS);
    assert.ok(firstSet.order?.id&&firstSet.sale?.id,'PUT cantidad devuelve pedido y venta para pintar sin GET adicional');
    const secondSet=await identity.setWaiterDraftItem(demo.tenantId,waiter,sessionId,usable[1].id,2,null,V2_OPTIONS);
    assert.ok(secondSet.order?.id&&secondSet.sale?.id,'PUT cantidad conserva contrato de respuesta rápida');
    let draft=await identity.getWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.ok(draft.order?.id);
    assert.equal(draft.service.seats[0].items.length,1,'producto opcionalmente asignado a Persona 1');
    assert.equal(draft.service.unassigned.items.length,1,'producto puede seguir perteneciendo a la mesa');
    assert.equal(draft.service.billingMode,'CONJUNTA');
    assert.equal(draft.order.state,'BORRADOR','agregar productos no puede enviar a cocina');
    assert.equal(await prisma.restaurantCommand.count({where:{tenantId:demo.tenantId,orderId:draft.order.id}}),0,'no hay comanda antes de confirmar');

    const first=draft.order.items.find(x=>x.menuItemId===usable[0].id);
    const metaResult=await identity.updateOrderItemMeta(demo.tenantId,waiter,sessionId,first.id,{notes:'sin cebolla'},V2_OPTIONS);
    assert.equal(metaResult.item.notes,'sin cebolla','PATCH ítem devuelve la fila actualizada');
    assert.ok(Array.isArray(metaResult.service.allItems),'PATCH ítem devuelve servicio para pintar sin GET adicional');
    draft=await identity.getWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.equal(draft.order.items.find(x=>x.id===first.id).notes,'sin cebolla');

    const sent=await identity.sendWaiterDraft(demo.tenantId,waiter,sessionId,V2_OPTIONS);
    assert.equal(sent.state,'ENVIADO');
    assert.ok(sent.commands.length>=1,'confirmar crea comandas reales');
    assert.ok(Number((await prisma.comprobanteComercial.findUnique({where:{id:saleId}})).total)>0,'venta borrador conserva total real');

    console.log(JSON.stringify({ok:true,module:'PEDIDOS_V2_P3',occupiedTableRegressionCovered:true,v1IsolationPreserved:true,sharedFloorOptIn:true,noBillingQuestion:true,optionalPersons:true,reviewBeforeSend:true,commandsOnlyAfterConfirm:true,fastMutationResponses:true,sendRefreshScope:'selected-draft-only'}));
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
