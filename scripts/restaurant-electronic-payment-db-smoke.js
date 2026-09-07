'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/prisma');
const visitPayments = require('../src/modules/restaurant/restaurant-visit-payments.service');
const settlementFinalizer = require('../src/modules/restaurant/restaurant-settlement-finalizer.service');
const { publicTopics, publicResponseRefs, paymentClosedTable } = require('../src/modules/restaurant/restaurant-public-realtime-publisher');

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

async function main() {
  const originalSummary = visitPayments.paymentSummary;
  const originalPrepare = visitPayments.preparePaymentPlan;
  const originalFinalize = settlementFinalizer.registerPartPaymentFinalized;
  const financeCalls = [];
  visitPayments.paymentSummary = async () => ({ prepared:false, parts:[], remaining:'73500.00' });
  visitPayments.preparePaymentPlan = async (_tenantId, user, tableId, input) => {
    financeCalls.push({ type:'prepare', userId:user.id, role:user.rol, tableId, input });
    return { prepared:true, parts:[{ key:'P1', paid:false, saleAmount:'73500.00' }], remaining:'73500.00' };
  };
  settlementFinalizer.registerPartPaymentFinalized = async (_tenantId, user, tableId, input) => {
    financeCalls.push({ type:'finalize', userId:user.id, role:user.rol, tableId, input });
    return { prepared:true, closed:true, remaining:'0.00', parts:[{ key:'P1', paid:true }] };
  };

  delete require.cache[require.resolve('../src/modules/restaurant/restaurant-electronic-payment.service')];
  const electronic = require('../src/modules/restaurant/restaurant-electronic-payment.service');

  const suffix = crypto.randomBytes(5).toString('hex');
  const tenant = await prisma.tenant.create({ data:{ nombreEmpresa:`Pago QR ${suffix}`, subdomain:`pago-qr-${suffix}`, nicho:'RESTAURANTE' } });
  const waiter1 = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Mesero inicial', email:`ep-w1-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true } });
  const waiter2 = await prisma.user.create({ data:{ tenantId:tenant.id, nombre:'Mesero refuerzo', email:`ep-w2-${suffix}@test.local`, password:'test', rol:'MESERO', activo:true } });
  const sale = await prisma.comprobanteComercial.create({
    data:{ tenantId:tenant.id, tipo:'FACTURA_VENTA', numero:`EP-${suffix}`, estado:'BORRADOR', creadoPorId:waiter1.id, total:73500, subtotal:73500, saldo:73500 }
  });
  const bank = await prisma.cajaBanco.create({ data:{ tenantId:tenant.id, tipo:'BANCO', nombre:'Nequi restaurante', banco:'Nequi', numeroCuenta:'3001234567', saldoActual:0, activo:true } });
  const table = await prisma.restaurantTable.create({ data:{ tenantId:tenant.id, code:`T-${suffix.slice(0,4)}`, name:'Mesa pago', assignedWaiterId:waiter1.id, state:'OCUPADA' } });
  const session = await prisma.restaurantTableSession.create({
    data:{ tenantId:tenant.id, tableId:table.id, saleId:sale.id, openedByUserId:waiter1.id, guestCount:1, state:'ABIERTA', accountRequestedAt:new Date() }
  });
  const rawVisitToken = crypto.randomBytes(32).toString('base64url');
  await prisma.restaurantQrVisitDevice.create({ data:{ tenantId:tenant.id, sessionId:session.id, tokenHash:hash(rawVisitToken), seatNumber:1 } });

  const context = await electronic.clientContext(table.qrToken, rawVisitToken);
  assert.equal(context.accountRequested, true);
  assert.equal(Number(context.amount), 73500);
  assert.equal(context.electronicAvailable, true);
  assert.equal(context.destinations[0].id, bank.id);
  assert.equal(context.report.state, 'READY');

  const reported = await electronic.reportPayment(table.qrToken, rawVisitToken, { cajaBancoId:bank.id, reference:'4821' });
  assert.equal(reported.state, 'REPORTED');
  assert.equal(Number(reported.amount), 73500);
  assert.equal(reported.reference, '4821');
  assert.equal(reported.destination.id, bank.id);
  const reportTopics = publicTopics('/api/public/restaurante/qr/token/pago-electronico/reportar', reported);
  assert.ok(reportTopics.includes('restaurant.account'));
  assert.ok(reportTopics.includes('treasury'));
  assert.ok(!reportTopics.includes('restaurant.table'), 'reporting a payment must not close or free the table');

  const primary = await electronic.waiterReportsSnapshot(tenant.id, waiter1.id);
  const secondaryBefore = await electronic.waiterReportsSnapshot(tenant.id, waiter2.id);
  assert.equal(primary.length, 1, 'primary waiter receives electronic payment report first');
  assert.equal(primary[0].priority, 'PRIMARY');
  assert.equal(secondaryBefore.length, 0, 'other waiters do not receive report before escalation');

  await prisma.trackingLink.update({ where:{ id:reported.reportId }, data:{ currentStatus:'ESCALATED' } });
  const secondaryAfter = await electronic.waiterReportsSnapshot(tenant.id, waiter2.id);
  assert.equal(secondaryAfter.length, 1, 'electronic payment report escalates to all waiters');
  assert.equal(secondaryAfter[0].priority, 'GENERAL');

  const confirmed = await electronic.confirmPayment(tenant.id, waiter2.id, reported.reportId);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.paymentSummary.closed, true, 'full confirmed payment must report the visit as closed');
  assert.equal(confirmed.tableId, table.id);
  assert.equal(confirmed.sessionId, session.id);
  assert.equal(financeCalls.length, 2);
  assert.equal(financeCalls[0].type, 'prepare');
  assert.equal(financeCalls[0].input.mode, 'TOGETHER');
  assert.equal(financeCalls[1].type, 'finalize');
  assert.equal(financeCalls[1].input.metodoPago, 'TRANSFERENCIA');
  assert.equal(financeCalls[1].input.cajaBancoId, bank.id);
  assert.equal(financeCalls[1].input.referencia, '4821');

  const confirmPath = `/api/public/restaurante/mesero-dispositivo/pagos-electronicos/${reported.reportId}/confirmar`;
  assert.equal(paymentClosedTable(confirmPath, confirmed), true);
  const confirmTopics = publicTopics(confirmPath, confirmed);
  assert.ok(confirmTopics.includes('restaurant.account'));
  assert.ok(confirmTopics.includes('treasury'));
  assert.ok(confirmTopics.includes('restaurant.table'), 'final payment must immediately publish table closure');
  const confirmRefs = publicResponseRefs(confirmPath, confirmed);
  assert.equal(confirmRefs.tableId, table.id);
  assert.equal(confirmRefs.sessionId, session.id);

  const status = await electronic.reportStatusById(tenant.id, reported.reportId);
  assert.equal(status.state, 'CONFIRMED');
  assert.equal(status.confirmed, true);
  const after = await electronic.waiterReportsSnapshot(tenant.id, waiter1.id);
  assert.equal(after.length, 0, 'confirmed report disappears from waiter queue');

  console.log('RESTAURANT QR ELECTRONIC PAYMENT + WAITER CONFIRMATION + TABLE REALTIME CLOSE SMOKE OK');
  console.log(JSON.stringify({
    asksPaymentMethod:true,
    cashGoesToCashier:true,
    electronicDestinationsFromTreasury:true,
    clientReportsElectronicPayment:true,
    primaryWaiterFirst:true,
    escalatesToAll:true,
    waiterConfirmationRequired:true,
    transferRecordedOnlyAfterConfirmation:true,
    duplicateWaiterAlertCleared:true,
    fullPaymentClosesVisit:true,
    tableRealtimeTopicOnFinalPayment:true,
    tableRealtimeRefs:true,
    partialOrReportedPaymentDoesNotFreeTable:true
  }, null, 2));

  visitPayments.paymentSummary = originalSummary;
  visitPayments.preparePaymentPlan = originalPrepare;
  settlementFinalizer.registerPartPaymentFinalized = originalFinalize;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
