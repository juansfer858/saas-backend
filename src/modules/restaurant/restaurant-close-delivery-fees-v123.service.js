'use strict';

// VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V123
// Presentation-only reconciliation helper. It does not create, reverse or move money.
// Scope is the same canonical close scope used by V119/V120: deliveries whose Pago
// was registered by the shift cashier inside the shift window.
const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const { resolveShiftRestaurantOperations } = require('./restaurant-shift-reconcile-scope.service');

const MARKER = 'VANTIX_RESTAURANT_CLOSE_DELIVERY_FEES_V123';

function emptySummary() {
  return {
    marker: MARKER,
    count: 0,
    billed: '0.00',
    collected: '0.00',
    cash: '0.00',
    bank: '0.00',
    pending: '0.00'
  };
}

function normalizeMethod(value) {
  return String(value || '').trim().toUpperCase();
}

function summarize(rows) {
  let count = 0;
  let billed = decimal(0);
  let collected = decimal(0);
  let cash = decimal(0);
  let bank = decimal(0);

  for (const row of rows || []) {
    const fee = decimal(row.deliveryFee || 0);
    if (!fee.gt(0)) continue;
    count += 1;
    billed = billed.plus(fee);
    if (String(row.paymentStatus || '').toUpperCase() !== 'PAGADO') continue;
    collected = collected.plus(fee);
    if (normalizeMethod(row.paymentMethod) === 'EFECTIVO') cash = cash.plus(fee);
    else bank = bank.plus(fee);
  }

  return {
    marker: MARKER,
    count,
    billed: money(billed).toString(),
    collected: money(collected).toString(),
    cash: money(cash).toString(),
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
  let cash = decimal(0);
  let bank = decimal(0);
  let pending = decimal(0);
  for (const row of rows || []) {
    count += Number(row?.count || 0);
    billed = billed.plus(row?.billed || 0);
    collected = collected.plus(row?.collected || 0);
    cash = cash.plus(row?.cash || 0);
    bank = bank.plus(row?.bank || 0);
    pending = pending.plus(row?.pending || 0);
  }
  return {
    marker: MARKER,
    count,
    billed: money(billed).toString(),
    collected: money(collected).toString(),
    cash: money(cash).toString(),
    bank: money(bank).toString(),
    pending: money(pending).toString()
  };
}

module.exports = { MARKER, emptySummary, summarize, summaryForShift, addSummaries };
