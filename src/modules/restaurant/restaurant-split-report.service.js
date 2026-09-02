'use strict';

const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const identity = require('./restaurant-identity.service');

function sumRows(rows, predicate = () => true) {
  return money(rows.filter(predicate).reduce((acc, row) => decimal(acc).plus(row.total || 0), decimal(0)));
}

function addBreakdown(bucket, key, label, kind, amount, accountName = null) {
  const normalizedKey = String(key || `${kind}:${label}`);
  const current = bucket.get(normalizedKey) || { key: normalizedKey, label, kind, accountName, count: 0, total: money(0) };
  current.count += 1;
  current.total = money(decimal(current.total).plus(amount || 0));
  bucket.set(normalizedKey, current);
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

  const baseSessionIds = (base.tables || []).map((row) => row.sessionId).filter(Boolean);
  const splitSessionIds = [...new Set(payments.map((row) => row.sessionId))];
  const allSessionIds = [...new Set([...baseSessionIds, ...splitSessionIds])];
  const sessions = allSessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: allSessionIds } },
    include: { table: true }
  }) : [];
  const sessionById = new Map(sessions.map((row) => [row.id, row]));

  const saleIds = [...new Set(sessions.map((row) => row.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, total: true, saldo: true, estado: true, formaPago: true }
  }) : [];
  const saleById = new Map(sales.map((row) => [row.id, row]));

  const accountIds = [...new Set([
    ...sessions.map((row) => row.paymentAccountId),
    ...payments.map((row) => row.cajaBancoId)
  ].filter(Boolean))];
  const accounts = accountIds.length ? await prisma.cajaBanco.findMany({
    where: { tenantId, id: { in: accountIds } },
    select: { id: true, nombre: true, tipo: true, banco: true, numeroCuenta: true }
  }) : [];
  const accountById = new Map(accounts.map((row) => [row.id, row]));

  const splitIds = new Set(splitSessionIds);
  const regularRows = (base.tables || []).filter((row) => !splitIds.has(row.sessionId)).map((row) => {
    const session = sessionById.get(row.sessionId);
    const account = session?.paymentAccountId ? accountById.get(session.paymentAccountId) || null : null;
    let kind = String(session?.paymentMethodKind || '').toUpperCase();
    if (!kind) kind = row.formaPago === 'EFECTIVO' ? 'EFECTIVO' : row.formaPago === 'CREDITO' ? 'CREDITO' : row.formaPago === 'BANCO' ? 'OTRO_ELECTRONICO' : 'SIN_CLASIFICAR';
    return {
      ...row,
      paymentMethodId: session?.paymentMethodId || null,
      paymentMethodLabel: session?.paymentMethodLabel || (kind === 'EFECTIVO' ? 'Efectivo' : kind === 'CREDITO' ? 'Crédito' : kind === 'OTRO_ELECTRONICO' ? 'Banco / electrónico' : 'Sin clasificar'),
      paymentMethodKind: kind,
      paymentAccountId: session?.paymentAccountId || null,
      paymentReference: session?.paymentReference || null,
      paymentAccount: account
    };
  });

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
      paymentMethodLabel: rows.length > 1 ? 'Pago mixto' : rows[0]?.metodoPago === 'EFECTIVO' ? 'Efectivo' : rows[0]?.metodoPago === 'TRANSFERENCIA' ? (accountById.get(rows[0]?.cajaBancoId)?.nombre || 'Transferencia') : (accountById.get(rows[0]?.cajaBancoId)?.nombre || 'Tarjeta'),
      paymentMethodKind: rows.length > 1 ? 'MIXTO' : rows[0]?.metodoPago || 'MIXTO',
      saleTotal: String(sale?.total || totalPaid),
      tipAmount: '0.00',
      total: totalPaid.toString(),
      state: session?.state || null,
      splitPayments: rows.map((row) => ({
        partKey: row.partKey,
        metodoPago: row.metodoPago,
        amount: String(row.saleAmount),
        paidAt: row.paidAt,
        cajaBancoId: row.cajaBancoId,
        accountName: accountById.get(row.cajaBancoId)?.nombre || null,
        reference: row.reference || null
      }))
    };
  });

  const methodBucket = new Map();
  for (const row of regularRows) {
    addBreakdown(methodBucket, row.paymentMethodId || `legacy:${row.paymentMethodKind}:${row.paymentMethodLabel}`, row.paymentMethodLabel, row.paymentMethodKind, row.total, row.paymentAccount?.nombre || null);
  }
  for (const payment of payments) {
    const account = accountById.get(payment.cajaBancoId) || null;
    const kind = String(payment.metodoPago || '').toUpperCase();
    const label = kind === 'EFECTIVO' ? 'Efectivo' : account?.nombre || (kind === 'TRANSFERENCIA' ? 'Transferencia' : 'Tarjeta');
    addBreakdown(methodBucket, `split:${kind}:${payment.cajaBancoId}`, label, kind, payment.saleAmount, account?.nombre || null);
  }

  const byMethod = [...methodBucket.values()].map((row) => ({ ...row, total: money(row.total) })).sort((a, b) => a.kind.localeCompare(b.kind, 'es') || a.label.localeCompare(b.label, 'es'));
  const totalFor = (kinds) => money(byMethod.filter((row) => kinds.includes(row.kind)).reduce((acc, row) => decimal(acc).plus(row.total), decimal(0)));
  const cashSales = totalFor(['EFECTIVO']);
  const transferSales = totalFor(['TRANSFERENCIA']);
  const cardSales = totalFor(['TARJETA']);
  const otherElectronicSales = totalFor(['OTRO_ELECTRONICO']);
  const electronicSales = money(decimal(transferSales).plus(cardSales).plus(otherElectronicSales));
  const creditSales = totalFor(['CREDITO']);
  const unclassifiedSales = totalFor(['SIN_CLASIFICAR']);
  const tips = money((base.tables || []).reduce((acc, row) => decimal(acc).plus(row.tipAmount || 0), decimal(0)));
  const paidTotal = money(decimal(cashSales).plus(electronicSales).plus(creditSales).plus(unclassifiedSales));
  const closedSplitTotal = money(splitRows.filter((row) => row.state === 'CERRADA').reduce((acc, row) => decimal(acc).plus(row.total), decimal(0)));
  const regularClosedTotal = sumRows(regularRows);

  return {
    ...base,
    tables: [...regularRows, ...splitRows],
    paymentBreakdown: {
      cashSales,
      transferSales,
      cardSales,
      electronicSales,
      otherElectronicSales,
      creditSales,
      unclassifiedSales,
      tips,
      restaurantTotal: paidTotal,
      byMethod
    },
    restaurantClosedTablesTotal: money(decimal(regularClosedTotal).plus(closedSplitTotal)),
    splitPaymentsRecorded: payments.length
  };
}

module.exports = { cashShiftSummary };
