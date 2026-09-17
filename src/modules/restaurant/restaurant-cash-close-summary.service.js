'use strict';

// VANTIX_RESTAURANT_CASH_CLOSE_SUMMARY_V121
// Presentation only: reads the immutable closure, never changes accounting totals.
function amount(value) {
  if (value == null) return 'Sin registro';
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(n)
    : 'Sin registro';
}

function short(value, limit = 60) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, limit);
}

function localTime(value, offset = 300) {
  if (!value) return 'Sin registro';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Sin registro';
  const n = Number(offset);
  return new Date(d.getTime() - (Number.isFinite(n) ? n : 300) * 60000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function methodBucket(value) {
  const method = String(value || '').trim().toUpperCase();
  if (method.includes('EFECTIVO')) return 'cash';
  if (method.includes('TRANSFER') || method.includes('QR')) return 'transfer';
  if (method.includes('TARJETA')) return 'card';
  if (method.includes('CREDITO') || method.includes('CRÉDITO')) return 'credit';
  return 'other';
}

function salesPayments(report) {
  const source = report.payments || {};
  const values = {
    cash:number(source.cash),
    transfer:number(source.transfer),
    card:number(source.card),
    credit:number(source.credit),
    other:number(source.other)
  };
  const rawTotal = Object.values(values).reduce((sum, value) => sum + value, 0);
  const billed = number(report.totals?.billedValue);
  const tips = number(report.totals?.tips);

  // Historical C86 snapshots could classify sale + tip inside the same payment bucket.
  // Only normalize when the excess over billed sales is exactly the recorded tips.
  if (tips > 0 && billed > 0 && Math.abs((rawTotal - billed) - tips) < 0.02) {
    for (const operation of report.operations || []) {
      const tip = number(operation.tips);
      if (!(tip > 0)) continue;
      const key = methodBucket(operation.paymentMethod);
      values[key] = Math.max(0, values[key] - tip);
    }
  }
  return values;
}

function normalizedExpenses(report) {
  const source = report.shift?.expenseSummary || report.expenses || {};
  return {
    cash:number(source.cash),
    transfer:number(source.transfer),
    total:number(source.total),
    count:Math.max(0, Math.trunc(number(source.count)))
  };
}

function closeCross(report) {
  const payments = salesPayments(report);
  const expenses = normalizedExpenses(report);
  const paymentTotal = Object.values(payments).reduce((sum, value) => sum + value, 0);
  const sales = number(report.totals?.billedValue ?? paymentTotal);
  const bankReceipts = payments.transfer + payments.card + payments.other;
  return {
    sales,
    expenses,
    salesMinusExpenses:sales - expenses.total,
    cashNet:payments.cash - expenses.cash,
    bankNet:bankReceipts - expenses.transfer,
    payments
  };
}

function summaryRows(report) {
  const rows = [];
  const add = (section, label, value) => rows.push({ section, label, value: String(value) });
  const shift = report.shift || {};
  const totals = report.totals || {};
  const cross = closeCross(report);
  const payments = cross.payments;
  const expenses = cross.expenses;
  const day = report.kind === 'DAY';

  add('TURNO', day ? 'Día operativo' : 'Turno', day ? report.businessDate : short(shift.id, 12).toUpperCase());
  if (!day) add('TURNO', 'Día operativo', report.businessDate || 'Ver fechas del turno');
  if (day) {
    add('TURNO', 'Turnos consolidados', report.shiftCount || 0);
    add('TURNO', 'Responsables', 'Consultar cada turno');
  } else {
    add('TURNO', 'Caja', short(shift.cajaNombre || 'Caja'));
    add('TURNO', 'Cajero', short(shift.cajero || 'Sin registro'));
    add('TURNO', 'Apertura', localTime(shift.abiertoEn, report.timezoneOffsetMinutes));
    add('TURNO', 'Cierre', localTime(shift.cerradoEn, report.timezoneOffsetMinutes));
  }

  add('VENTAS', 'Efectivo', amount(payments.cash));
  add('VENTAS', 'Transferencias / QR', amount(payments.transfer));
  if (payments.card !== 0) add('VENTAS', 'Tarjetas', amount(payments.card));
  add('VENTAS', 'Crédito', amount(payments.credit));
  if (payments.other !== 0) add('VENTAS', 'Otros medios', amount(payments.other));
  add('VENTAS', 'Valor total', amount(cross.sales));

  // Gastos are already posted through Tesorería. This section is report-only:
  // never subtract them again from saldoEsperado or any accounting accumulator.
  add('GASTOS', 'Cantidad de gastos', expenses.count);
  add('GASTOS', 'Efectivo', amount(expenses.cash));
  add('GASTOS', 'Banco / transferencia', amount(expenses.transfer));
  add('GASTOS', 'Total gastos', amount(expenses.total));

  add('CRUCE FINAL', 'Ventas', amount(cross.sales));
  add('CRUCE FINAL', '(-) Gastos', amount(expenses.total));
  add('CRUCE FINAL', 'Ventas - gastos', amount(cross.salesMinusExpenses));
  add('CRUCE FINAL', 'Flujo efectivo neto', amount(cross.cashNet));
  add('CRUCE FINAL', 'Flujo banco neto', amount(cross.bankNet));

  // Physical cash is canonical Treasury state. In particular, cash expenses are
  // already inside egresosEfectivo, so expectedCash must never be recomputed here.
  if (!day && report.cash) {
    add('CAJA', 'Efectivo esperado', amount(report.cash.expectedCash));
    add('CAJA', 'Efectivo contado', amount(report.cash.countedCash));
    add('CAJA', 'Descuadre', amount(report.cash.difference));
  }

  add('FIRMAS', 'Entrega cajero', '____________________');
  add('FIRMAS', 'Recibe / revisa', '____________________');
  return rows;
}

function legacyReport(snapshot) {
  const s = snapshot.shift || {};
  const p = snapshot.paymentBreakdown || {};
  return {
    shift: s,
    totals: {
      accountsCharged: snapshot.tables?.length,
      settledValue: snapshot.restaurantClosedTablesTotal,
      billedValue: snapshot.restaurantClosedTablesTotal
    },
    payments: {
      cash: p.cashSales,
      transfer: p.transferSales,
      card: p.cardSales,
      credit: p.creditSales,
      other: p.bankOtherSales
    },
    cash: {
      openingBalance: s.saldoInicial,
      cashIncome: s.ingresosEfectivo,
      cashOut: s.egresosEfectivo,
      expectedCash: snapshot.systemCashExpected,
      countedCash: s.saldoFinal,
      difference: s.descuadre
    }
  };
}

function summaryPdfSpec(tenant, report) {
  const entries = summaryRows(report);
  const rows = entries.map((entry) => [entry.label, entry.value]);
  return {
    title: 'Resumen cierre ' + (report.businessDate || '') + ' - ' + short(tenant.nombreEmpresa || tenant.subdomain || 'Restaurante'),
    headers: ['Concepto', 'Resultado'],
    columns: [
      { label: 'Concepto', width: .45, type: 'text', align: 'left' },
      { label: 'Resultado', width: .55, type: 'text', align: 'left' }
    ],
    rows,
    rowStyles: rows.map(() => 'data')
  };
}

module.exports = { summaryRows, legacyReport, summaryPdfSpec, salesPayments, normalizedExpenses, closeCross };
