'use strict';

// VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V125
// Presentation-only reconciliation helper. It does not create, reverse or move money.
// Scope is the same canonical close scope used by V119/V120: deliveries whose Pago
// was registered by the shift cashier inside the shift window.
const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const { resolveShiftRestaurantOperations } = require('./restaurant-shift-reconcile-scope.service');

const MARKER = 'VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V125';

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
    const bucket = methodBucket(row.paymentMethod);
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

async function summaryForShift(tenantId, shift, client = prisma) {
  if (!shift?.id || !shift?.userId || !shift?.abiertoEn) return emptySummary();
  const scope = await resolveShiftRestaurantOperations(client, tenantId, shift);
  const ids = [...new Set((scope.deliveries || []).map((row) => row.id).filter(Boolean))];
  if (!ids.length) return emptySummary();
  const rows = await client.restaurantDeliveryOrder.findMany({
    where: { tenantId, id: { in: ids }, state: { not: 'CANCELADO' } },
    select: {
      id: true,
      deliveryFee: true,
      paymentStatus: true,
      paymentMethod: true
    }
  });
  return summarize(rows);
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
    for (const key of Object.keys(buckets)) buckets[key] = buckets[key].plus(row?.[key] || 0);
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

module.exports = { MARKER, emptySummary, methodBucket, summarize, summaryForShift, addSummaries };
