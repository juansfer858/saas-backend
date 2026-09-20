'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const demoBar = require('../src/modules/restaurant/restaurant-demo-bar-accounts-v1.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const cash = require('../src/modules/restaurant/restaurant-v2-cash.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const user = await prisma.user.findUnique({ where:{ id:demo.users.ADMIN } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({
    data:{ tenantId:demo.tenantId, name:'BarFlow '+suffix, sortOrder:997 }
  });
  const table = await prisma.restaurantTable.create({
    data:{ tenantId:demo.tenantId, zoneId:zone.id, code:'BAR-'+suffix, name:'Mesa Bar '+suffix, seats:4 }
  });

  const createdSessions = [];
  const saleIds = [];
  try {
    const first = await demoBar.createAccount(demo.tenantId, user, table.id, { name:'Cuenta Ana' });
    createdSessions.push(first.account.id); saleIds.push(first.account.sale.id);
    const second = await demoBar.createAccount(demo.tenantId, user, table.id, { name:'Cuenta Luis' });
    createdSessions.push(second.account.id); saleIds.push(second.account.sale.id);

    let ws = await demoBar.workspace(demo.tenantId);
    let row = ws.tables.find(x=>x.id===table.id);
    assert.ok(row, 'table must be visible in demo workspace');
    assert.equal(row.accounts.length, 2, 'same location must allow two simultaneous accounts');
    assert.deepEqual(row.accounts.map(x=>x.name), ['Cuenta Ana','Cuenta Luis']);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state, 'OCUPADA');

    await demoBar.renameAccount(demo.tenantId, user, second.account.id, { name:'Cuenta Terraza' });
    ws = await demoBar.workspace(demo.tenantId);
    row = ws.tables.find(x=>x.id===table.id);
    assert.equal(row.accounts.find(x=>x.id===second.account.id).name, 'Cuenta Terraza');

    const menu = (await require('../src/modules/restaurant/restaurant.service').listMenu(demo.tenantId)).filter(x=>!x.warning&&x.product);
    assert.ok(menu.length, 'demo needs at least one sellable menu item');

    await identity.setWaiterDraftItem(demo.tenantId, user, first.account.id, menu[0].id, 2, null, V2_OPTIONS);
    const firstDraft = await identity.getWaiterDraft(demo.tenantId, user, first.account.id, V2_OPTIONS);
    assert.equal(Number(firstDraft.order.items[0].quantity), 2);
    assert.equal(firstDraft.order.state, 'BORRADOR');

    const detailOne = await cash.tableDetailBySession(demo.tenantId, user, first.account.id);
    const detailTwo = await cash.tableDetailBySession(demo.tenantId, user, second.account.id);
    assert.equal(detailOne.session.id, first.account.id, 'cash detail must target exact selected account');
    assert.equal(detailTwo.session.id, second.account.id, 'cash detail must not switch to newest table account');
    assert.notEqual(detailOne.sale.id, detailTwo.sale.id);

    await demoBar.requestAccount(demo.tenantId, user, second.account.id);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state, 'OCUPADA', 'one requested account cannot hide another open account');

    await demoBar.closeEmptyAccount(demo.tenantId, user, second.account.id);
    createdSessions.splice(createdSessions.indexOf(second.account.id),1);
    saleIds.splice(saleIds.indexOf(second.account.sale.id),1);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state, 'OCUPADA', 'closing one account must keep location occupied while sibling account remains');

    let blocked = false;
    try { await demoBar.closeEmptyAccount(demo.tenantId, user, first.account.id); }
    catch (error) { blocked = error.code === 'DEMO_BAR_EMPTY_ACCOUNT_HAS_ACTIVITY'; }
    assert.equal(blocked, true, 'account with consumption must not close as empty');

    const other = await prisma.tenant.create({
      data:{ nombreEmpresa:'Other '+suffix, subdomain:'other-'+suffix, nicho:'RESTAURANTE', pais:'CO', moneda:'COP', activo:true }
    });
    try {
      await assert.rejects(
        ()=>demoBar.workspace(other.id),
        error=>error.code==='DEMO_BAR_ACCOUNT_NOT_AVAILABLE',
        'demo account semantics must be tenant isolated'
      );
    } finally {
      await prisma.tenant.delete({where:{id:other.id}});
    }

    console.log('DEMO_BAR_BEHAVIOR_DB=PASS');
    console.log('MULTIPLE_ACCOUNTS_PER_LOCATION=PASS');
    console.log('EXACT_ACCOUNT_CASH_TARGET=PASS');
    console.log('SIBLING_ACCOUNT_PRESERVES_TABLE_STATE=PASS');
    console.log('TENANT_ISOLATION=PASS');
  } finally {
    for (const sessionId of createdSessions) {
      const orderIds=(await prisma.restaurantOrder.findMany({where:{tenantId:demo.tenantId,sessionId},select:{id:true}})).map(x=>x.id);
      if(orderIds.length){
        await prisma.restaurantCommand.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});
        await prisma.restaurantOrderItem.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});
        await prisma.restaurantOrder.deleteMany({where:{tenantId:demo.tenantId,id:{in:orderIds}}});
      }
      await prisma.restaurantQrVisitDevice.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantSessionPayment.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantFiscalDocument.deleteMany({where:{tenantId:demo.tenantId,sessionId}}).catch(()=>{});
      await prisma.restaurantTableSession.deleteMany({where:{tenantId:demo.tenantId,id:sessionId}});
    }
    for (const saleId of saleIds) {
      await prisma.detalleComprobante.deleteMany({where:{tenantId:demo.tenantId,comprobanteId:saleId}});
      await prisma.comprobanteComercial.deleteMany({where:{tenantId:demo.tenantId,id:saleId}});
    }
    await prisma.restaurantTable.deleteMany({where:{tenantId:demo.tenantId,id:table.id}});
    await prisma.restaurantZone.deleteMany({where:{tenantId:demo.tenantId,id:zone.id}});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
