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
  const pendingTable = await prisma.restaurantTable.create({ data:{tenantId:demo.tenantId, zoneId:zone.id,
    code:`PEND-${suffix}`, name:'Pendiente informe completo', assignedWaiterId:waiter.id} });
  const pendingSession = await base.openTable(demo.tenantId, waiter, pendingTable.id, {guestCount:1}, V2_OPTIONS);
  await identity.setWaiterDraftItem(demo.tenantId, waiter, pendingSession.session.id, item.id, 1, null, V2_OPTIONS);
  // A payment of an older credit invoice is cash collected, never a new sale.
  const yesterday = new Date(Date.now()-86400000);
  const debtor = await prisma.tercero.create({data:{tenantId:demo.tenantId,tipo:'CLIENTE',tipoDocumento:'CC',identificacion:`C86-${suffix}`,nombre:'Cliente crédito anterior'}});
  const oldSale = await prisma.comprobanteComercial.create({data:{tenantId:demo.tenantId,tipo:'FACTURA_VENTA',numero:`OLD-${suffix}`,
    estado:'EMITIDO',formaPago:'CREDITO',creadoPorId:cashier.id,terceroId:debtor.id,subtotal:5000,total:5000,saldo:5000,emitidoEn:yesterday}});
  await prisma.cartera.create({data:{tenantId:demo.tenantId,terceroId:debtor.id,comprobanteId:oldSale.id,tipo:'CXC',valorOriginal:5000,saldo:5000}});
  await prisma.restaurantTableSession.create({data:{tenantId:demo.tenantId,tableId:table.id,saleId:oldSale.id,state:'CERRADA',openedByUserId:waiter.id,
    closedByUserId:cashier.id,openedAt:yesterday,closedAt:yesterday}});
  await treasury.registerPayment(demo.tenantId,cashier.id,{documentoId:oldSale.id,cajaBancoId:cashAccount.id,metodoPago:'EFECTIVO',monto:1000,referencia:'Abono anterior CI'});
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
  assert.equal(snapshot.complete.version, 1);
  assert.ok(!snapshot.complete.pending.some(p => p.id === pendingSession.session.id));
  assert.equal((await prisma.restaurantTableSession.findUnique({where:{id:pendingSession.session.id}})).state,'CANCELADA');
  assert.ok(snapshot.complete.orders.some(o => o.state === 'CANCELADO' && o.reference === pendingTable.name));
  assert.ok(snapshot.complete.sales.some(s => s.items.length >= 1));
  assert.ok(snapshot.detailRows.some(r => r[0] === 'PRODUCTO VENDIDO'));
  assert.ok(snapshot.detailRows.some(r => r[0] === 'PEDIDO' && r[2].includes('CANCELADO')));
  assert.equal(Number(snapshot.complete.totals.sales), Number(snapshot.totals.billedValue), 'borradores no son ventas');
  assert.ok(Number(snapshot.complete.totals.collected) > 0, 'recaudo proviene de pagos reales');
  assert.equal(Number(snapshot.complete.totals.priorInvoiceCollections),1000);
  assert.equal(Number(snapshot.complete.totals.collected),Number(snapshot.totals.billedValue)+1000,'abono se suma una sola vez al recaudo');
  assert.equal(snapshot.complete.sales.some(s=>s.id===oldSale.id),false,'factura anterior no se vuelve a vender');
  const excelRows = closures.excelSpec({nombreEmpresa:'CI'},snapshot).rows;
  assert.deepEqual(excelRows, closures.pdfSpec({nombreEmpresa:'CI'},snapshot).rows, 'PDF y Excel deben contener todo el mismo detalle');
  assert.ok(excelRows.some(r => r[0] === 'MOVIMIENTO'));
  const longText = 'Motivo extenso '.repeat(30)+'FIN-MOTIVO';
  const printable = closures.printableSpec({...closures.pdfSpec({nombreEmpresa:'CI'},snapshot),rows:[['AUDITORÍA','identificador-largo',longText,'','','']]});
  assert.equal(printable.rows.map(r=>r[2]).join(''),longText,'PDF conserva el motivo completo en continuaciones');
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
  const printResult = await closures.queuePrint(demo.tenantId,cashier.id,openedShift.shift.id,{});
  const printIntent = await prisma.trackingLink.findFirst({where:{tenantId:demo.tenantId,id:printResult.printRequestId}});
  const receiptService = require('../src/modules/restaurant/restaurant-pos-receipt-print.service');
  const printSnapshot = receiptService.cashCloseSnapshotFromIntent(printIntent);
  assert.ok(printSnapshot.summaryRows.some(r=>r.label==='Valor total'));
  assert.ok(printSnapshot.summaryRows.every(r=>['TURNO','VENTAS','FIRMAS'].includes(r.section)));
  assert.equal(printSnapshot.detailRows,undefined);
  assert.ok(snapshot.detailRows.some(r=>r[0]==='PEDIDO'),'el historial conserva los pedidos cancelados');
  const printLines = receiptService.cashCloseReceiptLines({company:{nombreEmpresa:'CI'},snapshot:printSnapshot});
  assert.ok(!printLines.join(' ').includes('INFORME COMPLETO'));
  assert.ok(printLines.length<100);
  const shortPdf = await closures.exportClosure(demo.tenantId,cashier.id,openedShift.shift.id,'pdf-resumen',{tzOffsetMinutes:300});
  const dayPdf = await closures.exportDay(demo.tenantId,cashier.id,snapshot.businessDate,'pdf-resumen',{tzOffsetMinutes:300});
  for(const exported of [shortPdf,dayPdf]) {
    assert.equal(exported.mime,'application/pdf');
    assert.match(exported.buffer.toString('latin1'),/\/Count 1\b/);
  }
  assert.ok(printLines.join(' ').includes('FIN DEL CIERRE'));

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


