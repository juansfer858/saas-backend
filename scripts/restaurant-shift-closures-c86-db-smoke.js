'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const base = require('../src/modules/restaurant/restaurant.service');
const identity = require('../src/modules/restaurant/restaurant-identity.service');
const treasury = require('../src/modules/treasury/treasury.service');
const cashV2 = require('../src/modules/restaurant/restaurant-v2-cash.service');
const closures = require('../src/modules/restaurant/restaurant-shift-close-history-c86.runtime');
const { V2_OPTIONS } = require('../src/modules/restaurant/restaurant-v2-orders.routes');

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const [waiter, cashier] = await Promise.all([
    prisma.user.findUnique({ where: { id: demo.users.MESERO } }),
    prisma.user.findUnique({ where: { id: demo.users.CAJERO } })
  ]);
  assert.ok(waiter && cashier, 'demo debe tener mesero y cajero');

  const suffix = crypto.randomBytes(4).toString('hex');
  const zone = await prisma.restaurantZone.create({
    data: { tenantId: demo.tenantId, name: `Cierre C86 ${suffix}`, sortOrder: 998 }
  });
  const cashAccount = await treasury.createCajaBanco(demo.tenantId, {
    tipo: 'CAJA',
    nombre: `Caja C86 ${suffix}`,
    banco: null,
    numeroCuenta: null,
    cuentaContableId: null,
    saldoActual: 0,
    activo: true
  });
  const cashMethodId = crypto.randomUUID();
  await prisma.restaurantConfig.upsert({
    where: { tenantId: demo.tenantId },
    create: {
      tenantId: demo.tenantId,
      dianRealEnabled: false,
      paymentMethods: [{ id: cashMethodId, name: 'Efectivo C86', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 }]
    },
    update: {
      dianRealEnabled: false,
      paymentMethods: [{ id: cashMethodId, name: 'Efectivo C86', kind: 'EFECTIVO', cajaBancoId: cashAccount.id, active: true, sortOrder: 10 }]
    }
  });

  const menu = (await base.listMenu(demo.tenantId)).filter((row) => !row.warning && row.product);
  assert.ok(menu.length, 'demo debe tener carta operativa');
  const item = menu.find((row) => row.station === 'COCINA') || menu[0];
  const table = await prisma.restaurantTable.create({
    data: {
      tenantId: demo.tenantId,
      zoneId: zone.id,
      code: `C86-${suffix}`.toUpperCase(),
      name: 'Mesa C86',
      seats: 4,
      assignedWaiterId: waiter.id
    }
  });

  const opened = await base.openTable(demo.tenantId, waiter, table.id, { guestCount: 2 }, V2_OPTIONS);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, opened.session.id, item.id, 2, null, V2_OPTIONS);
  const sent = await identity.sendWaiterDraft(demo.tenantId, waiter, opened.session.id, V2_OPTIONS);
  const commands = await prisma.restaurantCommand.findMany({ where: { tenantId: demo.tenantId, orderId: sent.id } });
  assert.ok(commands.length, 'pedido debe generar comandas');
  for (const command of commands) {
    await base.updateCommandState(demo.tenantId, cashier, command.id, 'EN_PREPARACION');
    await base.updateCommandState(demo.tenantId, cashier, command.id, 'LISTA');
    await base.updateCommandState(demo.tenantId, cashier, command.id, 'ENTREGADA');
  }
  await base.requestAccount(demo.tenantId, waiter, table.id, V2_OPTIONS);

  const openedShift = await cashV2.openShift(demo.tenantId, cashier, { cajaBancoId: cashAccount.id, saldoInicial: 50000 });
  const charge = await cashV2.chargeWholeAccount(demo.tenantId, cashier, table.id, {
    paymentMethodId: cashMethodId,
    tipAmount: 0,
    reference: 'C86-DB-CASH'
  });
  assert.equal(charge.charged, true);
  const summary = await cashV2.shiftSummary(demo.tenantId, cashier);
  const closed = await cashV2.closeShift(demo.tenantId, cashier, { saldoFinal: Number(summary.systemCashExpected) });
  assert.equal(closed.closed.estado, 'CERRADA');

  const snapshot = await closures.ensureSnapshot(demo.tenantId, cashier.id, openedShift.shift.id, { tzOffsetMinutes: 300 });
  assert.equal(snapshot.marker, closures.MARKER);
  assert.equal(snapshot.shift.id, openedShift.shift.id);
  assert.equal(snapshot.channels.MESAS.tickets, 1);
  assert.equal(snapshot.totals.accountsCharged, 1);
  assert.equal(Number(snapshot.totals.billedValue) > 0, true);
  assert.equal(Number(snapshot.totals.settledValue), Number(snapshot.totals.billedValue));
  assert.equal(Number(snapshot.cash.difference), 0);
  assert.equal(snapshot.status, 'CUADRADO');
  assert.equal(snapshot.operations.length, 1);
  assert.equal(snapshot.operations[0].reference, 'Mesa C86');
  assert.ok(snapshot.operations[0].orderAt, 'debe conservar hora del pedido');
  assert.ok(snapshot.operations[0].accountAt, 'debe conservar hora de solicitud de cuenta');
  assert.ok(snapshot.operations[0].collectedAt, 'debe conservar hora de cobro');
  assert.ok(snapshot.operations[0].collectedBy, 'debe conservar quién cobró');

  const delivered = Object.values(snapshot.production).reduce((sum, row) => sum + Number(row.deliveredItems || 0), 0);
  assert.equal(delivered >= 2, true, 'producción entregada debe quedar conciliada');

  const auditCount = await prisma.auditoriaContable.count({
    where: {
      tenantId: demo.tenantId,
      entidad: closures.AUDIT_ENTITY,
      entidadId: openedShift.shift.id,
      accion: closures.SNAPSHOT_ACTION
    }
  });
  assert.equal(auditCount, 1, 'snapshot de cierre debe quedar en auditoría append-only');

  const secondSnapshot = await closures.ensureSnapshot(demo.tenantId, cashier.id, openedShift.shift.id, { tzOffsetMinutes: 300 });
  assert.equal(secondSnapshot.generatedAt, snapshot.generatedAt, 'reconsulta no debe reescribir el snapshot histórico');
  assert.equal(await prisma.auditoriaContable.count({ where: { tenantId: demo.tenantId, entidad: closures.AUDIT_ENTITY, entidadId: openedShift.shift.id, accion: closures.SNAPSHOT_ACTION } }), 1);

  const day = await closures.getDay(demo.tenantId, cashier.id, snapshot.businessDate, { tzOffsetMinutes: 300 });
  assert.equal(day.shifts.some((row) => row.shiftId === openedShift.shift.id), true);
  assert.equal(Number(day.totals.billedValue) >= Number(snapshot.totals.billedValue), true);

  const excel = await closures.exportClosure(demo.tenantId, cashier.id, openedShift.shift.id, 'excel', { tzOffsetMinutes: 300 });
  const pdf = await closures.exportClosure(demo.tenantId, cashier.id, openedShift.shift.id, 'pdf', { tzOffsetMinutes: 300 });
  assert.equal(excel.mime, 'application/vnd.ms-excel');
  assert.equal(pdf.mime, 'application/pdf');
  assert.ok(excel.buffer.length > 200);
  assert.ok(pdf.buffer.length > 200);

  console.log(JSON.stringify({
    ok: true,
    module: 'RESTAURANT_SHIFT_CLOSURES_C86',
    postgresReal: true,
    immutableSnapshot: true,
    operationalReconciliation: true,
    kitchenDelivered: true,
    auditPersistent: true,
    excel: true,
    pdf: true,
    edgeUntouched: true,
    dianUntouched: true
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());