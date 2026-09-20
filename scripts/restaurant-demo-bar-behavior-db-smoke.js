'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const demoBar = require('../src/modules/restaurant/restaurant-demo-bar-accounts-v1.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const cash = require('../src/modules/restaurant/restaurant-v2-cash.service');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function cleanup(demo, table, zone) {
  const sessions = await prisma.restaurantTableSession.findMany({
    where:{ tenantId:demo.tenantId, tableId:table.id },
    select:{ id:true, saleId:true }
  });
  const sessionIds=sessions.map(x=>x.id);
  const saleIds=sessions.map(x=>x.saleId);
  const orderIds=sessionIds.length ? (await prisma.restaurantOrder.findMany({
    where:{ tenantId:demo.tenantId, sessionId:{ in:sessionIds } },
    select:{ id:true }
  })).map(x=>x.id) : [];
  if(orderIds.length){
    await prisma.restaurantCommand.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});
    await prisma.restaurantOrderItem.deleteMany({where:{tenantId:demo.tenantId,orderId:{in:orderIds}}});
    await prisma.restaurantOrder.deleteMany({where:{tenantId:demo.tenantId,id:{in:orderIds}}});
  }
  if(sessionIds.length){
    await prisma.restaurantQrVisitDevice.deleteMany({where:{tenantId:demo.tenantId,sessionId:{in:sessionIds}}}).catch(()=>{});
    await prisma.restaurantSessionPayment.deleteMany({where:{tenantId:demo.tenantId,sessionId:{in:sessionIds}}}).catch(()=>{});
    await prisma.restaurantFiscalDocument.deleteMany({where:{tenantId:demo.tenantId,sessionId:{in:sessionIds}}}).catch(()=>{});
    await prisma.restaurantTableSession.deleteMany({where:{tenantId:demo.tenantId,id:{in:sessionIds}}});
  }
  if(saleIds.length){
    await prisma.detalleComprobante.deleteMany({where:{tenantId:demo.tenantId,comprobanteId:{in:saleIds}}});
    await prisma.comprobanteComercial.deleteMany({where:{tenantId:demo.tenantId,id:{in:saleIds}}});
  }
  await prisma.restaurantTable.deleteMany({where:{tenantId:demo.tenantId,id:table.id}});
  await prisma.restaurantZone.deleteMany({where:{tenantId:demo.tenantId,id:zone.id}});
}

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

  try {
    const first = await demoBar.createAccount(demo.tenantId, user, table.id, { name:'Cuenta Ana' });
    const second = await demoBar.createAccount(demo.tenantId, user, table.id, { name:'Cuenta Luis' });

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

    const menu = (await restaurant.listMenu(demo.tenantId)).filter(x=>!x.warning&&x.product);
    assert.ok(menu.length, 'demo needs at least one sellable menu item');

    await identity.setWaiterDraftItem(demo.tenantId, user, first.account.id, menu[0].id, 2, null, V2_OPTIONS);
    let detail = await demoBar.accountDetail(demo.tenantId, first.account.id);
    assert.equal(detail.items.length, 1);
    assert.equal(Number(detail.items[0].quantity), 2);
    assert.equal(detail.items[0].operationalState, 'POR_ENVIAR');

    const sent = await identity.sendWaiterDraft(demo.tenantId, user, first.account.id, V2_OPTIONS);
    assert.equal(sent.state, 'ENVIADO');
    const commandCountBeforeSplit = await prisma.restaurantCommand.count({
      where:{ tenantId:demo.tenantId, orderId:sent.id }
    });
    assert.ok(commandCountBeforeSplit >= 1, 'sent order must create production commands');

    detail = await demoBar.accountDetail(demo.tenantId, first.account.id);
    assert.equal(detail.items[0].operationalState, 'PENDIENTE');
    const sourceDetailId = detail.items[0].saleDetailId;

    const split = await demoBar.splitAccount(demo.tenantId, user, first.account.id, {
      name:'Cuenta separada',
      lines:[{ detailId:sourceDetailId, quantity:1 }]
    });
    assert.ok(split.accountId, 'split must create a real destination account');

    const sourceAfterSplit = await demoBar.accountDetail(demo.tenantId, first.account.id);
    const destAfterSplit = await demoBar.accountDetail(demo.tenantId, split.accountId);
    assert.equal(Number(sourceAfterSplit.items[0].quantity), 1, 'source must retain one unit');
    assert.equal(Number(destAfterSplit.items[0].quantity), 1, 'destination must receive one unit');
    assert.equal(destAfterSplit.items[0].operationalState, 'PENDIENTE', 'split sent consumption must keep production state');
    assert.equal(destAfterSplit.items[0].originTable.id, table.id, 'split line retains operational origin');
    const commandCountAfterSplit = await prisma.restaurantCommand.count({
      where:{ tenantId:demo.tenantId, orderId:sent.id }
    });
    assert.equal(commandCountAfterSplit, commandCountBeforeSplit, 'splitting financial ownership must not duplicate production commands');

    await demoBar.mergeAccounts(demo.tenantId, user, first.account.id, {
      name:'Cuenta Ana unificada',
      sources:[split.accountId]
    });
    const firstAfterMerge = await demoBar.accountDetail(demo.tenantId, first.account.id);
    assert.equal(firstAfterMerge.items.reduce((sum,item)=>sum+Number(item.quantity),0), 2, 'merge must restore both units in destination account');
    const splitSession = await prisma.restaurantTableSession.findUnique({ where:{ id:split.accountId } });
    assert.equal(splitSession.state, 'CANCELADA', 'merged source account must leave active workspace');
    const commandCountAfterMerge = await prisma.restaurantCommand.count({
      where:{ tenantId:demo.tenantId, orderId:sent.id }
    });
    assert.equal(commandCountAfterMerge, commandCountBeforeSplit, 'merge must not duplicate production commands');

    const detailOne = await cash.tableDetailBySession(demo.tenantId, user, first.account.id);
    const detailTwo = await cash.tableDetailBySession(demo.tenantId, user, second.account.id);
    assert.equal(detailOne.session.id, first.account.id, 'cash detail must target exact selected account');
    assert.equal(detailTwo.session.id, second.account.id, 'cash detail must not switch to newest table account');
    assert.notEqual(detailOne.sale.id, detailTwo.sale.id);

    await demoBar.requestAccount(demo.tenantId, user, second.account.id);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state, 'OCUPADA', 'one requested account cannot hide another open account');

    await demoBar.closeEmptyAccount(demo.tenantId, user, second.account.id);
    assert.equal((await prisma.restaurantTable.findUnique({where:{id:table.id}})).state, 'OCUPADA', 'closing one account must keep location occupied while sibling account remains');

    let blocked = false;
    try { await demoBar.closeEmptyAccount(demo.tenantId, user, first.account.id); }
    catch (error) { blocked = error.code === 'DEMO_BAR_EMPTY_ACCOUNT_HAS_ACTIVITY'; }
    assert.equal(blocked, true, 'account with consumption must not close as empty');

    const cashWorkspace = await cash.workspace(demo.tenantId, user);
    if (!cashWorkspace.shift.own) {
      const cashAccount = cashWorkspace.shift.cashAccounts[0];
      assert.ok(cashAccount, 'demo needs a cash account to test exact-session charge');
      await cash.openShift(demo.tenantId, user, { cajaBancoId: cashAccount.id, saldoInicial: 0 });
    }
    const cashDetail = await cash.tableDetailBySession(demo.tenantId, user, first.account.id);
    const paymentMethod = cashDetail.paymentMethods.find(method => method.kind === 'EFECTIVO') || cashDetail.paymentMethods[0];
    assert.ok(paymentMethod, 'demo needs an active non-credit payment method');
    const charged = await cash.chargeWholeAccountBySession(demo.tenantId, user, first.account.id, {
      paymentMethodId: paymentMethod.id,
      tipAmount: 0,
      reference: 'Recibido 17280 · Cambio 0'
    });
    assert.equal(charged.charged, true, 'exact-session account must charge successfully');
    assert.equal(charged.result.session.id, first.account.id, 'charge must close the selected session');
    assert.equal((await prisma.restaurantTableSession.findUnique({ where:{ id:first.account.id } })).state, 'CERRADA');

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
    console.log('SENT_LINE_PARTIAL_SPLIT=PASS');
    console.log('SPLIT_MERGE_DO_NOT_DUPLICATE_PRODUCTION=PASS');
    console.log('EXACT_ACCOUNT_CASH_TARGET=PASS');
    console.log('SIBLING_ACCOUNT_PRESERVES_TABLE_STATE=PASS');
    console.log('EXACT_ACCOUNT_CHARGE=PASS');
    console.log('TENANT_ISOLATION=PASS');
  } finally {
    await cleanup(demo,table,zone);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());
