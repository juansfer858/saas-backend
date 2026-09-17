'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { summaryRows, summaryPdfSpec } = require('./restaurant-cash-close-summary.service');
const expenses = require('./restaurant-expenses-v116.service');
const deliveryFees = require('./restaurant-close-delivery-fees-v123.service');
const base = require('./restaurant-shift-close-history-c86.service');
const posReceiptPrint = require('./restaurant-pos-receipt-print.service');
const { toExcelHtml, toSimplePdf } = require('../accounting/accounting-export.service');

async function expenseTotalsForDayReport(tenantId, report, client = prisma) {
  const shiftIds = [...new Set((report?.shifts || []).map((row) => row.shiftId).filter(Boolean))];
  if (!shiftIds.length) return { cash:'0.00', transfer:'0.00', total:'0.00', count:0 };
  const shifts = await client.aperturaCierreCaja.findMany({
    where:{ tenantId, id:{ in:shiftIds } },
    select:{ id:true, userId:true, abiertoEn:true, cerradoEn:true }
  });
  let cash = 0; let transfer = 0; let total = 0; let count = 0;
  for (const shift of shifts) {
    const row = await expenses.expenseSummaryForShift(tenantId, shift, client);
    cash += base.number(row.cash);
    transfer += base.number(row.transfer);
    total += base.number(row.total);
    count += Number(row.count || 0);
  }
  return {
    cash:base.moneyString(cash),
    transfer:base.moneyString(transfer),
    total:base.moneyString(total),
    count
  };
}

function applyCanonicalMethods(report, canonicalMethods) {
  if (!canonicalMethods || !Array.isArray(report?.operations)) return report;
  return {
    ...report,
    operations: report.operations.map((row) => (
      row.channel === 'DOMICILIOS' && canonicalMethods[row.id]
        ? { ...row, paymentMethod:canonicalMethods[row.id] }
        : row
    ))
  };
}

async function canonicalDeliveryForShift(tenantId, shift, report, client = prisma) {
  const reconciliation = await deliveryFees.reconcileForShift(tenantId, shift, client);
  const correctedPayments = deliveryFees.applyPaymentCorrections(report?.payments, reconciliation.corrections);
  return applyCanonicalMethods({
    ...report,
    payments:correctedPayments,
    deliveryFees:reconciliation.summary
  }, reconciliation.canonicalMethods);
}

async function deliveryDayReconciliation(tenantId, report, client = prisma) {
  const shiftIds = [...new Set((report?.shifts || []).map((row) => row.shiftId).filter(Boolean))];
  if (!shiftIds.length) {
    return {
      summary:deliveryFees.emptySummary(),
      corrections:deliveryFees.emptyCorrections(),
      canonicalMethods:{}
    };
  }
  const shifts = await client.aperturaCierreCaja.findMany({
    where:{ tenantId, id:{ in:shiftIds } },
    select:{ id:true, userId:true, abiertoEn:true, cerradoEn:true }
  });
  const rows = [];
  for (const shift of shifts) rows.push(await deliveryFees.reconcileForShift(tenantId, shift, client));
  return {
    summary:deliveryFees.addSummaries(rows.map((row) => row.summary)),
    corrections:deliveryFees.addCorrections(rows.map((row) => row.corrections)),
    canonicalMethods:Object.assign({}, ...rows.map((row) => row.canonicalMethods))
  };
}

async function deliveryFeeTotalsForDayReport(tenantId, report, client = prisma) {
  return (await deliveryDayReconciliation(tenantId, report, client)).summary;
}

async function getClosure(tenantId, userId, shiftId, options = {}, client = prisma) {
  const report = await base.getClosure(tenantId, userId, shiftId, options, client);
  return canonicalDeliveryForShift(tenantId, report.shift, report, client);
}

async function getDay(tenantId, userId, date, options = {}, client = prisma) {
  const report = await base.getDay(tenantId, userId, date, options, client);
  const [expenseTotals, deliveryReconciliation] = await Promise.all([
    expenseTotalsForDayReport(tenantId, report, client),
    deliveryDayReconciliation(tenantId, report, client)
  ]);
  const correctedPayments = deliveryFees.applyPaymentCorrections(report.payments, deliveryReconciliation.corrections);
  return applyCanonicalMethods({
    ...report,
    payments:correctedPayments,
    expenses:expenseTotals,
    deliveryFees:deliveryReconciliation.summary
  }, deliveryReconciliation.canonicalMethods);
}

async function tenantIdentity(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({
    where:{ id:tenantId },
    select:{ id:true, nit:true, nombreEmpresa:true, subdomain:true, moneda:true, pais:true }
  });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  return tenant;
}

async function exportReport(tenantId, report, format, client = prisma) {
  const tenant = await tenantIdentity(tenantId, client);
  const normalized = String(format || '').toLowerCase();
  if (['xls','excel'].includes(normalized)) {
    const spec = base.excelSpec(tenant, report);
    return { buffer:toExcelHtml(spec), mime:'application/vnd.ms-excel', extension:'xls', title:spec.title };
  }
  if (normalized === 'pdf-resumen') {
    const spec = summaryPdfSpec(tenant, report);
    return { buffer:toSimplePdf(spec), mime:'application/pdf', extension:'pdf', title:spec.title };
  }
  if (normalized === 'pdf') {
    const spec = base.pdfSpec(tenant, report);
    return { buffer:toSimplePdf(base.printableSpec(spec)), mime:'application/pdf', extension:'pdf', title:spec.title };
  }
  throw new AppError(400, 'Formato de cierre no soportado', 'RESTAURANT_SHIFT_CLOSE_EXPORT_FORMAT_INVALID');
}

async function exportClosure(tenantId, userId, shiftId, format, options = {}, client = prisma) {
  return exportReport(tenantId, await getClosure(tenantId, userId, shiftId, options, client), format, client);
}

async function exportDay(tenantId, userId, date, format, options = {}, client = prisma) {
  return exportReport(tenantId, await getDay(tenantId, userId, date, options, client), format, client);
}

async function queuePrint(tenantId, userId, shiftId, options = {}, client = prisma) {
  const snapshot = await getClosure(tenantId, userId, shiftId, options, client);
  const saved = {
    shift:snapshot.shift,
    systemCashExpected:snapshot.cash.expectedCash,
    restaurantClosedTablesTotal:snapshot.totals.expectedSettlement,
    paymentBreakdown:{ cashSales:snapshot.payments.cash, transferSales:snapshot.payments.transfer,
      cardSales:snapshot.payments.card, creditSales:snapshot.payments.credit, bankOtherSales:snapshot.payments.other },
    deliveryFees:snapshot.deliveryFees,
    tables:snapshot.operations.map(o => ({ table:o.reference, saleNumber:o.saleNumber,
      total:o.collectedValue, paymentMethodLabel:o.paymentMethod })),
    summaryRows:summaryRows(snapshot)
  };
  const queued = await posReceiptPrint.queueShiftCloseIntent(tenantId, shiftId, client, saved);
  if (!queued?.queued) {
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
        printFormat: 'SUMMARY_V121'
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

module.exports = {
  ...base,
  getClosure,
  getDay,
  exportClosure,
  exportDay,
  expenseTotalsForDayReport,
  deliveryFeeTotalsForDayReport,
  deliveryDayReconciliation,
  queuePrint
};
