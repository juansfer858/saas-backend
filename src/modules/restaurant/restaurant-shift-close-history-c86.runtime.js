'use strict';

const { prisma } = require('../../config/prisma');
const { summaryRows } = require('./restaurant-cash-close-summary.service');
const base = require('./restaurant-shift-close-history-c86.service');
const posReceiptPrint = require('./restaurant-pos-receipt-print.service');

async function queuePrint(tenantId, userId, shiftId, options = {}, client = prisma) {
  const snapshot = await base.ensureSnapshot(tenantId, userId, shiftId, options, client);
  const saved = {
    shift:snapshot.shift,
    systemCashExpected:snapshot.cash.expectedCash,
    restaurantClosedTablesTotal:snapshot.totals.expectedSettlement,
    paymentBreakdown:{ cashSales:snapshot.payments.cash, transferSales:snapshot.payments.transfer,
      cardSales:snapshot.payments.card, creditSales:snapshot.payments.credit, bankOtherSales:snapshot.payments.other },
    tables:snapshot.operations.map(o => ({ table:o.reference, saleNumber:o.saleNumber,
      total:o.collectedValue, paymentMethodLabel:o.paymentMethod })),
    summaryRows:summaryRows(snapshot)
  };
  const queued = await posReceiptPrint.queueShiftCloseIntent(tenantId, shiftId, client, saved);
  if (!queued?.queued) {
    const { AppError } = require('../../utils/app-error');
    throw new AppError(409, 'No fue posible preparar la impresión del cierre', 'RESTAURANT_SHIFT_CLOSE_PRINT_QUEUE_FAILED', { reason: queued?.reason || 'UNKNOWN' });
  }
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: base.AUDIT_ENTITY,
      entidadId: shiftId,
      accion: base.PRINT_ACTION,
      metadata: {
        marker: base.MARKER,
        version: base.VERSION,
        label: options.origin === 'CLOSE_FLOW' ? 'Imprimir cierre al finalizar turno' : 'Reimprimir cierre histórico',
        businessDate: snapshot.businessDate,
        printRequestId: queued.intentId || null,
        origin: options.origin || 'HISTORY',
        printFormat: 'SUMMARY_V110'
      }
    }
  });
  return {
    marker: base.MARKER,
    shiftId,
    businessDate: snapshot.businessDate,
    queued: true,
    printRequestId: queued.intentId || null
  };
}

module.exports = { ...base, queuePrint };

