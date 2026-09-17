'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { summaryRows, summaryPdfSpec } = require('./restaurant-cash-close-summary.service');
const expenses = require('./restaurant-expenses-v116.service');
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

async function getDay(tenantId, userId, date, options = {}, client = prisma) {
  const report = await base.getDay(tenantId, userId, date, options, client);
  return { ...report, expenses:await expenseTotalsForDayReport(tenantId, report, client) };
}

async function tenantIdentity(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({
    where:{ id:tenantId },
    select:{ id:true, nit:true, nombreEmpresa:true, subdomain:true, moneda:true, pais:true }
  });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  return tenant;
}

async function exportDay(tenantId, userId, date, format, options = {}, client = prisma) {
  const report = await getDay(tenantId, userId, date, options, client);
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

module.exports = { ...base, getDay, exportDay, expenseTotalsForDayReport, queuePrint };
