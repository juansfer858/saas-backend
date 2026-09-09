'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const work = require('../src/modules/restaurant/restaurant-employee-work.service');
const kds = require('../src/modules/restaurant/restaurant-v2-kds.service');
const splitV2 = require('../src/modules/restaurant/restaurant-v2-split.service');
const cashV2 = require('../src/modules/restaurant/restaurant-v2-cash.service');
const treasury = require('../src/modules/treasury/treasury.service');
const printingStations = require('../src/modules/platform/printing/printing-stations.service');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function salePayments(tenantId, saleId) {
  return prisma.pago.findMany({
    where:{ tenantId, documentoId:saleId },
    select:{ id:true, comprobanteTesoreriaId:true, monto:true },
    orderBy:{ creadoEn:'asc' }
  });
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const [admin, waiter, cook, cashier] = await Promise.all([
    prisma.user.findUnique({ where:{ id:demo.users.ADMIN } }),
    prisma.user.findUnique({ where:{ id:demo.users.MESERO } }),
    prisma.user.findUnique({ where:{ id:demo.users.COCINA } }),
    prisma.user.findUnique({ where:{ id:demo.users.CAJERO } })
  ]);
  assert.ok(admin && waiter && cook && cashier, 'El demo necesita ADMIN, MESERO, COCINA y CAJERO');

  const suffix = crypto.randomBytes(5).toString('hex');
  const zone = await prisma.restaurantZone.create({
    data:{ tenantId:demo.tenantId, name:`E2E V2 ${suffix}`, sortOrder:994 }
  });
  const table = await prisma.restaurantTable.create({
    data:{
      tenantId:demo.tenantId,
      zoneId:zone.id,
      code:`E2E-${suffix}`,
      name:`Mesa E2E ${suffix}`,
      seats:4,
      assignedWaiterId:waiter.id
    }
  });

  const menu = (await restaurant.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  const kitchenItem = menu.find((row) => row.station === 'COCINA');
  const barItem = menu.find((row) => row.station === 'BARRA');
  assert.ok(kitchenItem && barItem, 'La auditoría necesita un producto de COCINA y uno de BARRA');

  const [kitchenStation, barStation] = await Promise.all([
    printingStations.createStation(demo.tenantId, admin.id, {
      name:`Cocina E2E ${suffix}`, queue:'COCINA', mode:'KDS', active:true, sortOrder:10
    }),
    printingStations.createStation(demo.tenantId, admin.id, {
      name:`Barra E2E ${suffix}`, queue:'BARRA', mode:'KDS', active:true, sortOrder:20
    })
  ]);
  assert.equal(kitchenStation.active, true);
  assert.equal(barStation.active, true);
  await work.saveProfile(demo.tenantId, admin.id, cook.id, { stations:['COCINA','BARRA'] });

  // 1. MESA: una sola visita y una sola venta real.
  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, { guestCount:2 }, V2_OPTIONS);
  assert.equal(opened.table.state, 'OCUPADA');
  assert.ok(opened.session.id && opened.sale.id);
  assert.equal(opened.session.saleId, opened.sale.id);

  // 2. PEDIDO: agregar no crea comandas; confirmar crea exactamente una por estación.
  const draft1 = await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, kitchenItem.id, 2, 1, V2_OPTIONS);
  const draft2 = await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, barItem.id, 1, 2, V2_OPTIONS);
  assert.equal(draft2.order.id, draft1.order.id, 'Los productos de la ronda deben compartir el mismo borrador');
  assert.equal(await prisma.restaurantCommand.count({ where:{ tenantId:demo.tenantId, orderId:draft1.order.id } }), 0, 'El borrador no crea comandas');

  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  const commands = await prisma.restaurantCommand.findMany({
    where:{ tenantId:demo.tenantId, orderId:draft1.order.id },
    orderBy:{ station:'asc' }
  });
  assert.equal(commands.length, 2, 'Confirmar debe crear una comanda por estación real');
  assert.deepEqual([...new Set(commands.map((row) => row.station))].sort(), ['BARRA','COCINA']);
  assert.ok(commands.every((row) => row.state === 'PENDIENTE'));

  // 3. KDS: ambas estaciones visibles; transición estricta hasta ENTREGADA.
  const kitchenWorkspace = await kds.workspace(demo.tenantId, cook, { station:'COCINA' });
  const barWorkspace = await kds.workspace(demo.tenantId, cook, { station:'BARRA' });
  assert.equal(kitchenWorkspace.commands.some((row) => row.orderId === draft1.order.id), true);
  assert.equal(barWorkspace.commands.some((row) => row.orderId === draft1.order.id), true);
  assert.equal(kitchenWorkspace.queues.find((row) => row.queue === 'COCINA').configured, true);
  assert.equal(barWorkspace.queues.find((row) => row.queue === 'BARRA').configured, true);

  for (const command of commands) {
    await assert.rejects(
      () => kds.updateState(demo.tenantId, cook, command.id, 'LISTA'),
      (error) => error?.code === 'RESTAURANT_V2_KDS_TRANSITION_INVALID' || error?.statusCode === 409 || error?.status === 409
    );
    await kds.updateState(demo.tenantId, cook, command.id, 'EN_PREPARACION');
    await kds.updateState(demo.tenantId, cook, command.id, 'LISTA');
    await kds.updateState(demo.tenantId, cook, command.id, 'ENTREGADA');
  }
  const delivered = await prisma.restaurantCommand.findMany({ where:{ tenantId:demo.tenantId, orderId:draft1.order.id } });
  assert.ok(delivered.every((row) => row.state === 'ENTREGADA' && row.startedAt && row.readyAt && row.deliveredAt));

  // 4. CUENTA: la misma visita pasa a cuenta solicitada, sin venta paralela.
  await restaurant.requestAccount(demo.tenantId, waiter, table.id, V2_OPTIONS);
  let session = await prisma.restaurantTableSession.findUnique({ where:{ id:opened.session.id } });
  let sale = await prisma.comprobanteComercial.findUnique({ where:{ id:opened.sale.id } });
  assert.equal(session.state, 'CUENTA_PEDIDA');
  assert.equal(session.saleId, opened.sale.id);
  assert.ok(Number(sale.total) > 0);

  // 5. CAJA/DIVISIÓN: DIAN apagada, turno real, una sola venta y dos abonos.
  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo:'CAJA', nombre:`Caja E2E ${suffix}`, banco:null, numeroCuenta:null, cuentaContableId:null, saldoActual:0, activo:true
  });
  const cashMethodId = crypto.randomUUID();
  await prisma.restaurantConfig.upsert({
    where:{ tenantId:demo.tenantId },
    create:{
      tenantId:demo.tenantId,
      dianRealEnabled:false,
      allowSimulatedDocumentEquivalent:false,
      paymentMethods:[{ id:cashMethodId, name:'Efectivo E2E', kind:'EFECTIVO', cajaBancoId:cashAccount.id, active:true, sortOrder:1 }]
    },
    update:{
      dianRealEnabled:false,
      allowSimulatedDocumentEquivalent:false,
      paymentMethods:[{ id:cashMethodId, name:'Efectivo E2E', kind:'EFECTIVO', cajaBancoId:cashAccount.id, active:true, sortOrder:1 }]
    }
  });

  await cashV2.openShift(demo.tenantId, cashier, { cajaBancoId:cashAccount.id, saldoInicial:0 });
  const prepared = await splitV2.prepare(demo.tenantId, cashier, table.id, { mode:'EQUAL', parts:2 });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.parts.length, 2);
  assert.equal(prepared.sale.id, opened.sale.id, 'División debe conservar la venta original');
  assert.equal(prepared.operation.dianRequired, false);
  assert.equal(prepared.operation.electronicInvoiceRequired, false);

  const first = await splitV2.payPart(demo.tenantId, cashier, table.id, {
    partKey:'P1', paymentMethodId:cashMethodId, reference:'E2E-P1'
  });
  assert.equal(first.closed, false);
  assert.ok(Number(first.remaining) > 0);

  const second = await splitV2.payPart(demo.tenantId, cashier, table.id, {
    partKey:'P2', paymentMethodId:cashMethodId, reference:'E2E-P2'
  });
  assert.equal(second.closed, true);
  assert.equal(Number(second.remaining), 0);

  // 6. CIERRE: mesa libre, visita cerrada, venta pagada, Tesorería+Contabilidad reales.
  [session, sale] = await Promise.all([
    prisma.restaurantTableSession.findUnique({ where:{ id:opened.session.id } }),
    prisma.comprobanteComercial.findUnique({ where:{ id:opened.sale.id } })
  ]);
  const freed = await prisma.restaurantTable.findUnique({ where:{ id:table.id } });
  const payments = await salePayments(demo.tenantId, opened.sale.id);
  const receiptIds = payments.map((row) => row.comprobanteTesoreriaId).filter(Boolean);
  const [treasuryMoves, saleEntry, receiptEntries, simulatedFiscal, parallelSales] = await Promise.all([
    prisma.movimientoTesoreria.count({ where:{ tenantId:demo.tenantId, comprobanteId:{ in:receiptIds } } }),
    prisma.asientoContable.findFirst({ where:{ tenantId:demo.tenantId, comprobanteId:opened.sale.id } }),
    prisma.asientoContable.count({ where:{ tenantId:demo.tenantId, comprobanteId:{ in:receiptIds } } }),
    prisma.restaurantFiscalDocument.count({ where:{ tenantId:demo.tenantId, saleId:opened.sale.id, mode:'SIMULATED' } }),
    prisma.restaurantTableSession.count({ where:{ tenantId:demo.tenantId, tableId:table.id, saleId:{ not:opened.sale.id } } })
  ]);

  assert.equal(session.state, 'CERRADA');
  assert.equal(freed.state, 'LIBRE');
  assert.equal(sale.estado, 'PAGADO_TOTAL');
  assert.equal(Number(sale.saldo), 0);
  assert.equal(payments.length, 2);
  assert.equal(receiptIds.length, 2);
  assert.equal(treasuryMoves, 2);
  assert.ok(saleEntry, 'La venta debe tener asiento de emisión');
  assert.equal(receiptEntries, 2, 'Cada abono debe tener asiento contable');
  assert.equal(simulatedFiscal, 0, 'DIAN apagada no debe producir documento SIMULATED');
  assert.equal(parallelSales, 0, 'La visita no debe generar una venta paralela');

  console.log(JSON.stringify({
    ok:true,
    audit:'RESTAURANT_V2_E2E_POST_P6',
    realPostgres:true,
    tableOpened:true,
    singleSale:true,
    draftBeforeCommands:true,
    commandsOnConfirm:true,
    kdsStrictTransitions:true,
    allDelivered:true,
    accountRequested:true,
    splitSameSale:true,
    partialPayments:true,
    treasuryReal:true,
    accountingReal:true,
    tableFreedAtZero:true,
    dianNonBlocking:true
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
