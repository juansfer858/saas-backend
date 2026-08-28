'use strict';

const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const identity = require('./restaurant-identity.service');

function sumRows(rows, predicate = () => true) {
  return money(rows.filter(predicate).reduce((acc, row) => decimal(acc).plus(row.total || 0), decimal(0)));
}

async function cashShiftSummary(tenantId, userId, shiftId) {
  const base = await identity.cashShiftSummary(tenantId, userId, shiftId);
  const shift = base.shift;
  const end = shift.cerradoEn || new Date();
  const payments = await prisma.restaurantSessionPayment.findMany({
    where: {
      tenantId,
      recordedByUserId: userId,
      paidAt: { gte: shift.abiertoEn, lte: end }
    },
    orderBy: { paidAt: 'asc' }
  });
  if (!payments.length) return base;

  const sessionIds = [...new Set(payments.map((row) => row.sessionId))];
  const sessions = await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: sessionIds } },
    include: { table: true }
  });
  const sessionById = new Map(sessions.map((row) => [row.id, row]));
  const sales = sessions.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: sessions.map((row) => row.saleId) } },
    select: { id: true, numero: true, total: true, saldo: true, estado: true }
  }) : [];
  const saleById = new Map(sales.map((row) => [row.id, row]));
  const splitIds = new Set(sessionIds);
  const regularRows = (base.tables || []).filter((row) => !splitIds.has(row.sessionId));

  const paymentsBySession = new Map();
  for (const payment of payments) {
    if (!paymentsBySession.has(payment.sessionId)) paymentsBySession.set(payment.sessionId, []);
    paymentsBySession.get(payment.sessionId).push(payment);
  }

  const splitRows = [...paymentsBySession.entries()].map(([sessionId, rows]) => {
    const session = sessionById.get(sessionId);
    const sale = saleById.get(session?.saleId);
    const totalPaid = sumRows(rows.map((row) => ({ total: row.saleAmount })));
    return {
      sessionId,
      table: session?.table?.name || 'Mesa',
      saleNumber: sale?.numero || null,
      formaPago: rows.length > 1 || new Set(rows.map((row) => row.metodoPago)).size > 1 ? 'MIXTO' : rows[0]?.metodoPago || 'MIXTO',
      saleTotal: String(sale?.total || totalPaid),
      tipAmount: '0.00',
      total: totalPaid.toString(),
      state: session?.state || null,
      splitPayments: rows.map((row) => ({ partKey: row.partKey, metodoPago: row.metodoPago, amount: String(row.saleAmount), paidAt: row.paidAt }))
    };
  });

  const regularCash = sumRows(regularRows, (row) => row.formaPago === 'EFECTIVO');
  const regularElectronic = sumRows(regularRows, (row) => row.formaPago === 'BANCO');
  const regularCredit = sumRows(regularRows, (row) => row.formaPago === 'CREDITO');
  const splitCash = money(payments.filter((row) => row.metodoPago === 'EFECTIVO').reduce((acc, row) => decimal(acc).plus(row.saleAmount), decimal(0)));
  const splitElectronic = money(payments.filter((row) => ['TRANSFERENCIA', 'TARJETA'].includes(row.metodoPago)).reduce((acc, row) => decimal(acc).plus(row.saleAmount), decimal(0)));
  const paidTotal = money(decimal(regularCash).plus(regularElectronic).plus(regularCredit).plus(splitCash).plus(splitElectronic));
  const closedSplitTotal = money(splitRows.filter((row) => row.state === 'CERRADA').reduce((acc, row) => decimal(acc).plus(row.total), decimal(0)));
  const regularClosedTotal = sumRows(regularRows);

  return {
    ...base,
    tables: [...regularRows, ...splitRows],
    paymentBreakdown: {
      cashSales: money(decimal(regularCash).plus(splitCash)),
      electronicSales: money(decimal(regularElectronic).plus(splitElectronic)),
      creditSales: regularCredit,
      tips: base.paymentBreakdown?.tips || money(0),
      restaurantTotal: paidTotal
    },
    restaurantClosedTablesTotal: money(decimal(regularClosedTotal).plus(closedSplitTotal)),
    splitPaymentsRecorded: payments.length
  };
}

module.exports = { cashShiftSummary };
