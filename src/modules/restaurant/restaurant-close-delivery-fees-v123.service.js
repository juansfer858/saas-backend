'use strict';

// VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V127
// Read-only reconciliation helper. The linked Pago is authoritative for payment method.
// It never creates, reverses or moves money.
const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const { resolveShiftRestaurantOperations } = require('./restaurant-shift-reconcile-scope.service');

const MARKER = 'VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V127';
const PAYMENT_KEYS = Object.freeze(['cash', 'transfer', 'card', 'credit', 'other']);

function emptySummary() {
  return {
    marker: MARKER,
    count: 0,
    billed: '0.00',
    collected: '0.00',
    cash: '0.00',
    transfer: '0.00',
    card: '0.00',
    credit: '0.00',
    other: '0.00',
    bank: '0.00',
    pending: '0.00'
  };
}

function emptyCorrections() {
  return { cash: 0, transfer: 0, card: 0, credit: 0, other: 0 };
}

function normalizeMethod(value) {
  return String(value || '').trim().toUpperCase();
}

function methodBucket(value) {
  const method = normalizeMethod(value);
  if (method.includes('EFECTIVO')) return 'cash';
  if (method.includes('TRANSFER') || method.includes('QR') || method === 'BANCO') return 'transfer';
  if (method.includes('TARJETA')) return 'card';
  if (method.includes('CREDITO') || method.includes('CRÉDITO')) return 'credit';
  return 'other';
}

function summarize(rows) {
  let count = 0;
  let billed = decimal(0);
  let collected = decimal(0);
  const buckets = {
    cash: decimal(0),
    transfer: decimal(0),
    card: decimal(0),
    credit: decimal(0),
    other: decimal(0)
  };

  for (const row of rows || []) {
    const fee = decimal(row.deliveryFee || 0);
    if (!fee.gt(0)) continue;
    count += 1;
    billed = billed.plus(fee);
    if (String(row.paymentStatus || '').toUpperCase() !== 'PAGADO') continue;
    collected = collected.plus(fee);
    const bucket = methodBucket(row.canonicalPaymentMethod || row.paymentMethod);
    buckets[bucket] = buckets[bucket].plus(fee);
  }

  const bank = buckets.transfer.plus(buckets.card).plus(buckets.other);
  return {
    marker: MARKER,
    count,
    billed: money(billed).toString(),
    collected: money(collected).toString(),
    cash: money(buckets.cash).toString(),
    transfer: money(buckets.transfer).toString(),
    card: money(buckets.card).toString(),
    credit: money(buckets.credit).toString(),
    other: money(buckets.other).toString(),
    bank: money(bank).toString(),
    pending: money(billed.minus(collected)).toString()
  };
}

function paymentCorrections(rows) {
  const result = emptyCorrections();
  for (const row of rows || []) {
    if (String(row.paymentStatus || '').toUpperCase() !== 'PAGADO') continue;
    const previousBucket = methodBucket(row.paymentMethod);
    const canonicalBucket = methodBucket(row.canonicalPaymentMethod || row.paymentMethod);
    if (previousBucket === canonicalBucket) continue;
    const amount = Number(row.canonicalPaymentAmount ?? row.total ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    result[previousBucket] -= amount;
    result[canonicalBucket] += amount;
  }
  return result;
}

function addCorrections(rows) {
  const result = emptyCorrections();
  for (const row of rows || []) {
    for (const key of PAYMENT_KEYS) result[key] += Number(row?.[key] || 0);
  }
  return result;
}

function applyPaymentCorrections(payments, corrections) {
  const source = payments || {};
  const result = {};
  for (const key of PAYMENT_KEYS) {
    result[key] = money(Math.max(0, Number(source[key] || 0) + Number(corrections?.[key] || 0))).toString();
  }
  result.total = money(PAYMENT_KEYS.reduce((sum, key) => sum + Number(result[key] || 0), 0)).toString();
  return result;
}

async function reconcileForShift(tenantId, shift, client = prisma) {
  if (!shift?.id || !shift?.userId || !shift?.abiertoEn) {
    return { summary: emptySummary(), corrections: emptyCorrections(), canonicalMethods: {} };
  }

  const scope = await resolveShiftRestaurantOperations(client, tenantId, shift);
  const deliveries = scope.deliveries || [];
  if (!deliveries.length) {
    return { summary: emptySummary(), corrections: emptyCorrections(), canonicalMethods: {} };
  }

  const paymentById = new Map((scope.paymentRows || []).map((row) => [row.id, row]));
  const feeRows = await client.restaurantDeliveryOrder.findMany({
    where: { tenantId, id: { in: deliveries.map((row) => row.id) }, state: { not: 'CANCELADO' } },
    select: { id: true, deliveryFee: true }
  });
  const feeById = new Map(feeRows.map((row) => [row.id, row.deliveryFee]));

  const rows = deliveries.map((row) => {
    const payment = paymentById.get(row.treasuryPaymentId) || null;
    return {
      ...row,
      deliveryFee: feeById.get(row.id) || 0,
      canonicalPaymentMethod: payment?.metodoPago || row.paymentMethod,
      canonicalPaymentAmount: payment?.monto ?? row.total
    };
  });

  return {
    summary: summarize(rows),
    corrections: paymentCorrections(rows),
    canonicalMethods: Object.fromEntries(
      rows.map((row) => [row.id, row.canonicalPaymentMethod || row.paymentMethod || null])
    )
  };
}

async function summaryForShift(tenantId, shift, client = prisma) {
  return (await reconcileForShift(tenantId, shift, client)).summary;
}

function addSummaries(rows) {
  let count = 0;
  let billed = decimal(0);
  let collected = decimal(0);
  let pending = decimal(0);
  const buckets = {
    cash: decimal(0),
    transfer: decimal(0),
    card: decimal(0),
    credit: decimal(0),
    other: decimal(0)
  };
  for (const row of rows || []) {
    count += Number(row?.count || 0);
    billed = billed.plus(row?.billed || 0);
    collected = collected.plus(row?.collected || 0);
    pending = pending.plus(row?.pending || 0);
    for (const key of PAYMENT_KEYS) buckets[key] = buckets[key].plus(row?.[key] || 0);
  }
  const bank = buckets.transfer.plus(buckets.card).plus(buckets.other);
  return {
    marker: MARKER,
    count,
    billed: money(billed).toString(),
    collected: money(collected).toString(),
    cash: money(buckets.cash).toString(),
    transfer: money(buckets.transfer).toString(),
    card: money(buckets.card).toString(),
    credit: money(buckets.credit).toString(),
    other: money(buckets.other).toString(),
    bank: money(bank).toString(),
    pending: money(pending).toString()
  };
}

module.exports = {
  MARKER,
  emptySummary,
  emptyCorrections,
  methodBucket,
  summarize,
  paymentCorrections,
  addCorrections,
  applyPaymentCorrections,
  reconcileForShift,
  summaryForShift,
  addSummaries
};
