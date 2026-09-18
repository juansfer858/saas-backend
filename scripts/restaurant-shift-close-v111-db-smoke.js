'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {prisma} = require('../src/config/prisma');
const {ensureRestaurantDemoTenant} = require('./ensure-restaurant-demo-tenant');
const base = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const cash = require('../src/modules/restaurant/restaurant-v2-cash.service');
const treasury = require('../src/modules/treasury/treasury.service');
const kds = require('../src/modules/restaurant/restaurant-v2-kds.service');
const guard = require('../src/modules/restaurant/restaurant-shift-close-v111.service');
const options = {sharedFloor:true,optionalSeat:true};

async function main(){
  const demo=await ensureRestaurantDemoTenant(),tenantId=demo.tenantId;
  const waiter=await prisma.user.findUnique({where:{id:demo.users.MESERO}});
  const cashier=await prisma.user.findUnique({where:{id:demo.users.CAJERO}});
  const menu=(await base.listMenu(tenantId)).find(m=>!m.warning&&m.product);
  const suffix=crypto.randomUUID();
  const account=await treasury.createCajaBanco(tenantId,{tipo:'CAJA',nombre:'Cierre V111 '+suffix,saldoActual:0,activo:true});
  const method=crypto.randomUUID();
  await prisma.restaurantConfig.update({where:{tenantId},data:{paymentMethods:[{id:method,name:'Efectivo',kind:'EFECTIVO',cajaBancoId:account.id,active:true}]}});
  const opened=await cash.openShift(tenantId,cashier,{cajaBancoId:account.id,saldoInicial:5000});
  async function visit(label,withItem=true){
    const table=await base.createTable(tenantId,{code:label+'-'+suffix,name:label,seats:2});
    const v=await base.openTable(tenantId,waiter,table.id,{guestCount:1},options);
    if(withItem)await identity.setWaiterDraftItem(tenantId,waiter,v.session.id,menu.id,1,null,options);
    return {...v,table};
  }
  const draft=await visit('Borrador a descartar'),empty=await visit('Mesa vacía',false),cancelled=await visit('Cancelada en cocina');
  const cancelledOrder=await identity.sendWaiterDraft(tenantId,waiter,cancelled.session.id,options);
  await kds.cancelOrder(tenantId,cashier,cancelledOrder.id,{reason:'No se preparó'});
  const pending=await visit('Consumo pendiente');
  const sent=await identity.sendWaiterDraft(tenantId,waiter,pending.session.id,options);
  async function pendingDetected(){
    const inspected = await guard.inspect(prisma,tenantId);
    assert.ok(inspected.blockers.some(row=>row.reference==='Consumo pendiente'));
    assert.equal((await prisma.aperturaCierreCaja.findUnique({where:{id:opened.shift.id}})).estado,'ABIERTA');
    assert.equal((await prisma.restaurantTableSession.findUnique({where:{id:draft.session.id}})).state,'ABIERTA');
    assert.equal((await prisma.comprobanteComercial.findUnique({where:{id:draft.sale.id}})).estado,'BORRADOR');
  }
  await pendingDetected();
  const commands=await prisma.restaurantCommand.findMany({where:{tenantId,orderId:sent.id}});
  for(const state of ['EN_PREPARACION','LISTA','ENTREGADA']){
    for(const command of commands)await base.updateCommandState(tenantId,cashier,command.id,state);
    await pendingDetected(); // Delivered but unpaid consumption must still be reported.
  }
  await base.requestAccount(tenantId,waiter,pending.table.id,options);
  await cash.chargeWholeAccount(tenantId,cashier,pending.table.id,{paymentMethodId:method,tipAmount:0});
  const summary=await cash.shiftSummary(tenantId,cashier);
  const input={saldoFinal:Number(summary.systemCashExpected)};
  const before=await prisma.restaurantOrder.findFirst({where:{tenantId,sessionId:draft.session.id,state:'BORRADOR'},include:{items:true}});
  const device=await prisma.restaurantQrVisitDevice.create({data:{tenantId,sessionId:draft.session.id,tokenHash:crypto.randomUUID()}});
  const foreign=await prisma.tenant.create({data:{nombreEmpresa:'Aislamiento '+suffix,subdomain:'v111-'+suffix,nicho:'RESTAURANTE_QA',pais:'CO',moneda:'COP'}});
  const foreignTable=await prisma.restaurantTable.create({data:{tenantId:foreign.id,code:'OTRO',name:'No tocar',state:'OCUPADA'}});
  const movements=await prisma.movimientoTesoreria.count({where:{tenantId}});
  // A late failure after cancellation AND closing the cash session rolls everything back.
  await assert.rejects(guard.closeRestaurantShift(tenantId,cashier.id,opened.shift.id,input,async tx=>{
    await base.closeCashShift(tenantId,cashier.id,opened.shift.id,input,tx);
    throw new Error('FALLO_SIMULADO');
  }),/FALLO_SIMULADO/);
  assert.equal((await prisma.restaurantOrder.findUnique({where:{id:before.id}})).state,'BORRADOR');
  assert.equal((await prisma.restaurantQrVisitDevice.findUnique({where:{id:device.id}})).revokedAt,null);
  assert.equal((await prisma.aperturaCierreCaja.findUnique({where:{id:opened.shift.id}})).estado,'ABIERTA');
  assert.equal(await prisma.auditoriaContable.count({where:{tenantId,entidadId:opened.shift.id,accion:'RESTAURANT_SHIFT_ALL_TABLES_CLOSED'}}),0);
  // Force an actual overlap: sender waits for the closing transaction, then rejects the closed visit.
  let release,entered;const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
  const closing=guard.closeRestaurantShift(tenantId,cashier.id,opened.shift.id,input,async tx=>{
    entered();await gate;return base.closeCashShift(tenantId,cashier.id,opened.shift.id,input,tx);
  });
  await ready;
  let senderDone=false;
  const sending=identity.sendWaiterDraft(tenantId,waiter,draft.session.id,options).then(()=>({sent:true}),e=>({error:e.code})).finally(()=>{senderDone=true});
  await new Promise(r=>setTimeout(r,100));
  assert.equal(senderDone,false,'el envío debe esperar el cierre atómico');
  release();
  const closed=await closing,result=await sending;
  assert.equal(closed.closed.estado,'CERRADA');
  assert.equal(result.error,'RESTAURANT_SESSION_NOT_FOUND');
  assert.equal(closed.operationalClose.cancelledDrafts,1);
  for(const v of [draft,empty,cancelled]){
    assert.equal((await prisma.restaurantTableSession.findUnique({where:{id:v.session.id}})).state,'CANCELADA');
    assert.equal((await prisma.comprobanteComercial.findUnique({where:{id:v.sale.id}})).estado,'ANULADO');
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:v.table.id}})).state,'LIBRE');
  }
  const archived=await prisma.restaurantOrder.findUnique({where:{id:before.id},include:{items:true,commands:true}});
  assert.equal(archived.state,'CANCELADO');assert.equal(archived.commands.length,0);
  assert.deepEqual(archived.items.map(i=>i.id),before.items.map(i=>i.id));
  assert.ok((await prisma.restaurantQrVisitDevice.findUnique({where:{id:device.id}})).revokedAt);
  assert.equal(await prisma.restaurantTableSession.count({where:{tenantId,state:{in:['ABIERTA','CUENTA_PEDIDA']}}}),0);
  assert.equal(await prisma.restaurantTable.count({where:{tenantId,state:{not:'LIBRE'}}}),0);
  assert.equal((await prisma.restaurantTable.findUnique({where:{id:foreignTable.id}})).state,'OCUPADA');
  assert.equal(await prisma.movimientoTesoreria.count({where:{tenantId}}),movements,'descartar borradores no mueve dinero');
  const audit=await prisma.auditoriaContable.findFirst({where:{tenantId,entidadId:draft.session.id,accion:'RESTAURANT_VISIT_CANCELLED_SHIFT_CLOSE'}});
  assert.equal(audit.metadata.reason,'Cierre de turno');
  const fresh=await base.openTable(tenantId,waiter,draft.table.id,{guestCount:1},options);
  assert.notEqual(fresh.session.id,draft.session.id);
  assert.equal(await prisma.restaurantOrder.count({where:{tenantId,sessionId:fresh.session.id}}),0);
  // V131: a new shift closes even with active production and an unpaid account.
  const nextShift = await cash.openShift(tenantId,cashier,{cajaBancoId:account.id,saldoInicial:0});
  await identity.setWaiterDraftItem(tenantId,waiter,fresh.session.id,menu.id,1,null,options);
  const pendingOrder = await identity.sendWaiterDraft(tenantId,waiter,fresh.session.id,options);
  const beforePending = await prisma.restaurantOrder.findUnique({where:{id:pendingOrder.id},include:{items:true,commands:true}});
  const pendingSale = await prisma.comprobanteComercial.findUnique({where:{id:fresh.sale.id}});
  const pendingMovements = await prisma.movimientoTesoreria.count({where:{tenantId}});
  const warningClose = await cash.closeShift(tenantId,cashier,{saldoFinal:0});
  assert.equal(warningClose.closed.estado,'CERRADA');
  assert.equal(warningClose.operationalClose.allTablesFree,false);
  assert.ok(warningClose.operationalClose.warnings.some(row=>row.type==='PRODUCCION_PENDIENTE_AL_CIERRE'));
  assert.ok(warningClose.operationalClose.warnings.some(row=>row.type==='CUENTA_PENDIENTE_AL_CIERRE'));
  assert.equal((await prisma.restaurantTableSession.findUnique({where:{id:fresh.session.id}})).state,'ABIERTA');
  assert.notEqual((await prisma.restaurantTable.findUnique({where:{id:draft.table.id}})).state,'LIBRE');
  assert.deepEqual(await prisma.restaurantOrder.findUnique({where:{id:pendingOrder.id},include:{items:true,commands:true}}),beforePending);
  assert.deepEqual(await prisma.comprobanteComercial.findUnique({where:{id:fresh.sale.id}}),pendingSale);
  assert.equal(await prisma.movimientoTesoreria.count({where:{tenantId}}),pendingMovements);
  const warningAudit = await prisma.auditoriaContable.findFirst({where:{tenantId,entidadId:nextShift.shift.id,accion:'RESTAURANT_SHIFT_ALL_TABLES_CLOSED'}});
  assert.deepEqual(warningAudit.metadata.warnings,warningClose.operationalClose.warnings);
  // Pending consumption remains usable in the following shift, without duplicate charges.
  const thirdShift = await cash.openShift(tenantId,cashier,{cajaBancoId:account.id,saldoInicial:0});
  assert.equal(thirdShift.shift.estado,'ABIERTA');
  for(const state of ['EN_PREPARACION','LISTA','ENTREGADA']) {
    for(const command of beforePending.commands) await base.updateCommandState(tenantId,cashier,command.id,state);
  }
  await base.requestAccount(tenantId,waiter,draft.table.id,options);
  await cash.chargeWholeAccount(tenantId,cashier,draft.table.id,{paymentMethodId:method,tipAmount:0});
  const paidLater = await prisma.restaurantTableSession.findUnique({where:{id:fresh.session.id}});
  assert.equal(paidLater.state,'CERRADA');
  assert.equal(paidLater.cashShiftId,thirdShift.shift.id);
  console.log('V131 OK: closes with preserved pending work, collects next shift, audit, draft disposal, rollback, concurrency, tenant isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
