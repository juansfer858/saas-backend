const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { money } = require('../src/utils/decimal');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const restaurant = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const visitPayments = require('../src/modules/restaurant/restaurant-visit-payments.service');
const treasury = require('../src/modules/treasury/treasury.service');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const waiter = await prisma.user.findUnique({ where: { id: demo.users.MESERO } });
  assert.ok(waiter, 'demo waiter must exist');

  const stamp = Date.now().toString().slice(-8);
  const admin = await prisma.user.findUnique({ where: { id: demo.users.ADMIN } });
  assert.ok(admin, 'demo admin must exist');
  const zone = await prisma.restaurantZone.create({ data: { tenantId: demo.tenantId, name: `KDS Smoke ${stamp}`, sortOrder: 999 } });
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `WV2-${stamp}`,
      name: `Mesa Mesero V2 ${stamp}`,
      seats: 6,
      assignedWaiterId: waiter.id
    }
  });
  const menu = await prisma.restaurantMenuItem.findMany({
    where: { tenantId: demo.tenantId, active: true },
    orderBy: { sortOrder: 'asc' },
    take: 3
  });
  assert.ok(menu.length >= 2, 'demo menu must contain products');

  const opened = await restaurant.openTable(demo.tenantId, waiter, table.id, {
    guestCount: 2,
    billingMode: 'INDIVIDUAL'
  });
  assert.equal(opened.session.billingMode, 'INDIVIDUAL');
  assert.equal(opened.session.guestCount, 2);

  // Permanent printed QR is not enough to order: every table opening has a new 4-digit visit code.
  const visitStatus = await visitPayments.staffVisitStatus(demo.tenantId, waiter, table.id);
  assert.match(visitStatus.visitCode, /^\d{4}$/);
  const wrongCode = visitStatus.visitCode === '0000' ? '0001' : '0000';
  await assert.rejects(
    () => visitPayments.authorizeVisit(table.qrToken, wrongCode, 1),
    (error) => error?.code === 'RESTAURANT_QR_VISIT_CODE_INVALID'
  );
  const authorized = await visitPayments.authorizeVisit(table.qrToken, visitStatus.visitCode, 1);
  assert.ok(authorized.visitToken);
  const verified = await visitPayments.verifyVisit(table.qrToken, authorized.visitToken);
  assert.equal(verified.device.seatNumber, 1);
  const movedDevice = await visitPayments.changeVisitSeat(table.qrToken, authorized.visitToken, 2);
  assert.equal(movedDevice.seatNumber, 2);

  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, 1);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[1].id, 2, 2);
  let draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.billingMode, 'INDIVIDUAL');
  assert.equal(draft.service.seats[0].items.length, 1);
  assert.equal(draft.service.seats[1].items.length, 1);

  const person2Item = draft.service.seats[1].items[0];
  await identity.updateOrderItemMeta(demo.tenantId, waiter, opened.session.id, person2Item.id, {
    notes: 'Sin cebolla'
  });
  draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.seats[1].items[0].notes, 'Sin cebolla');

  await assert.rejects(
    () => identity.updateTableServiceSetup(demo.tenantId, waiter, opened.session.id, { billingMode: 'CONJUNTA' }),
    (error) => error?.code === 'RESTAURANT_BILLING_MODE_LOCKED'
  );

  await identity.updateTableServiceSetup(demo.tenantId, waiter, opened.session.id, { guestCount: 3 });
  draft = await identity.getWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(draft.service.guestCount, 3);
  assert.equal(draft.service.seats.length, 3);

  const sent = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id);
  assert.equal(sent.state, 'ENVIADO');
  assert.ok(sent.commands.length >= 1);

  // QR order from the authorized phone is automatically attributed to that phone's person.
  const qrContext = await restaurant.getQrContext(table.qrToken);
  const qrMenu = qrContext.menu.find((row) => row.id === menu[0].id && row.available);
  assert.ok(qrMenu, 'QR menu item must be available');
  const base = money(qrMenu.product.price);
  const iva = money(base.mul(qrMenu.product.ivaPct || 0).div(100));
  const consumo = money(base.mul(qrMenu.product.impoconsumoPct || 0).div(100));
  const qrTotal = money(base.plus(iva).plus(consumo));
  const qrOrder = await visitPayments.placeAuthorizedQrOrder(table.qrToken, authorized.visitToken, {
    items: [{ menuItemId: qrMenu.id, quantity: 1 }],
    confirmedTotal: qrTotal.toString(),
    externalRequestId: `QR-VISIT-${stamp}`
  });
  assert.equal(qrOrder.items[0].seatNumber, 2);
  const storedQrItem = await prisma.restaurantOrderItem.findFirst({ where: { tenantId: demo.tenantId, orderId: qrOrder.id } });
  assert.equal(storedQrItem.seatNumber, 2);

  // Rotating the visit code immediately revokes every previously authorized phone.
  const rotated = await visitPayments.rotateVisit(demo.tenantId, waiter, table.id);
  assert.match(rotated.visitCode, /^\d{4}$/);
  assert.notEqual(rotated.visitCode, visitStatus.visitCode);
  await assert.rejects(
    () => visitPayments.verifyVisit(table.qrToken, authorized.visitToken),
    (error) => error?.code === 'RESTAURANT_QR_VISIT_INVALID'
  );
  const authorizedAfterRotation = await visitPayments.authorizeVisit(table.qrToken, rotated.visitCode, 3);
  assert.ok(authorizedAfterRotation.visitToken);

  const kdsRows = await restaurant.listCommands(demo.tenantId, admin, { limit: 200 });
  const kdsCommand = kdsRows.find((row) => row.orderId === sent.id);
  assert.ok(kdsCommand, 'KDS must expose the waiter order command');
  assert.equal(kdsCommand.waiter?.id, waiter.id);
  assert.equal(kdsCommand.waiter?.nombre, waiter.nombre);
  assert.equal(kdsCommand.order?.session?.table?.zone?.id, zone.id);
  assert.equal(kdsCommand.order?.session?.table?.zone?.name, zone.name);

  const prepared = await identity.prepareAccount(demo.tenantId, waiter, table.id);
  assert.ok(prepared.session.accountPreparedAt);
  assert.equal(prepared.session.cashierRequestedAt, null);

  const toCash = await identity.sendAccountToCash(demo.tenantId, waiter, table.id);
  assert.ok(toCash.session.cashierRequestedAt);
  let tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.id } });
  assert.equal(tableRow.state, 'CUENTA_PEDIDA');

  // A new round after asking for the bill reopens service, as in the existing restaurant workflow.
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, menu[0].id, 1, 3);
  await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id);
  let sessionRow = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.id } });
  assert.equal(sessionRow.state, 'ABIERTA');
  assert.equal(sessionRow.accountPreparedAt, null);
  assert.equal(sessionRow.cashierRequestedAt, null);
  assert.equal(tableRow.state, 'OCUPADA');

  // Payment plan freezes service, emits one credit sale and then uses the proven Treasury
  // partial-payment engine so every person may pay with a different real payment method.
  const cash = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'CAJA', nombre: `Caja Split ${stamp}`, saldoActual: 0 } });
  const bank = await prisma.cajaBanco.create({ data: { tenantId: demo.tenantId, tipo: 'BANCO', nombre: `Banco Split ${stamp}`, saldoActual: 0 } });
  await treasury.openCashSession(demo.tenantId, admin.id, cash.id, { saldoInicial: 0 });

  const plan = await visitPayments.preparePaymentPlan(demo.tenantId, admin, table.id, { mode: 'BY_SEAT', tipAmount: 0 });
  assert.equal(plan.prepared, true);
  assert.equal(plan.closed, false);
  assert.equal(plan.mode, 'BY_SEAT');
  assert.equal(plan.parts.length, 3);
  assert.equal(plan.parts.every((part) => !part.paid), true);
  sessionRow = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  assert.equal(sessionRow.state, 'CUENTA_PEDIDA');

  let settlement = await visitPayments.registerPartPayment(demo.tenantId, admin, table.id, {
    partKey: plan.parts[0].key,
    metodoPago: 'EFECTIVO',
    cajaBancoId: cash.id,
    referencia: 'Persona 1 efectivo'
  });
  assert.equal(settlement.closed, false);
  assert.equal(settlement.parts[0].paid, true);
  assert.ok(Number(settlement.remaining) > 0);

  settlement = await visitPayments.registerPartPayment(demo.tenantId, admin, table.id, {
    partKey: plan.parts[1].key,
    metodoPago: 'TRANSFERENCIA',
    cajaBancoId: bank.id,
    referencia: 'Persona 2 transferencia'
  });
  assert.equal(settlement.closed, false);

  settlement = await visitPayments.registerPartPayment(demo.tenantId, admin, table.id, {
    partKey: plan.parts[2].key,
    metodoPago: 'TARJETA',
    cajaBancoId: bank.id,
    referencia: 'Persona 3 tarjeta'
  });
  assert.equal(settlement.closed, true);
  assert.equal(money(settlement.remaining).eq(0), true);
  tableRow = await prisma.restaurantTable.findUnique({ where: { id: table.id } });
  sessionRow = await prisma.restaurantTableSession.findUnique({ where: { id: opened.session.id } });
  const saleRow = await prisma.comprobanteComercial.findUnique({ where: { id: opened.sale.id } });
  assert.equal(tableRow.state, 'LIBRE');
  assert.equal(sessionRow.state, 'CERRADA');
  assert.equal(saleRow.estado, 'PAGADO_TOTAL');
  assert.equal(money(saleRow.saldo).eq(0), true);

  const partPayments = await prisma.restaurantSessionPayment.findMany({ where: { tenantId: demo.tenantId, sessionId: opened.session.id }, orderBy: { paidAt: 'asc' } });
  assert.equal(partPayments.length, 3);
  assert.deepEqual(new Set(partPayments.map((row) => row.metodoPago)), new Set(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']));
  await assert.rejects(
    () => visitPayments.verifyVisit(table.qrToken, authorizedAfterRotation.visitToken),
    (error) => error?.code === 'RESTAURANT_QR_TABLE_NOT_OPEN'
  );

  console.log('RESTAURANT WAITER V2 + QR VISIT + SPLIT PAYMENTS POSTGRESQL SMOKE OK');
  console.log(JSON.stringify({
    billingMode: 'INDIVIDUAL',
    persons: 3,
    itemByPerson: true,
    notes: true,
    modeLock: true,
    prepareAccount: true,
    sendToCash: true,
    newRoundReopensService: true,
    kdsZoneAndWaiterContext: true,
    permanentQrRequiresVisitCode: true,
    visitTokenRevocable: true,
    qrOrderAttributedToPerson: true,
    splitByPerson: true,
    differentPaymentMethods: true,
    tableClosesOnlyAtZeroBalance: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
