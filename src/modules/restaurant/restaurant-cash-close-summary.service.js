'use strict';

// VANTIX_RESTAURANT_CASH_CLOSE_SUMMARY_V115
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

function summaryRows(report) {
  const rows = [];
  const add = (section, label, value) => rows.push({ section, label, value: String(value) });
  const shift = report.shift || {};
  const totals = report.totals || {};
  const payments = report.payments || {};
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
  if (Number(payments.card || 0) !== 0) add('VENTAS', 'Tarjetas', amount(payments.card));
  add('VENTAS', 'Crédito', amount(payments.credit));
  if (Number(payments.other || 0) !== 0) add('VENTAS', 'Otros medios', amount(payments.other));

  const paymentTotal = ['cash', 'transfer', 'card', 'credit', 'other']
    .reduce((sum, key) => sum + (Number(payments[key]) || 0), 0);
  const totalValue = totals.settledValue ?? totals.billedValue ?? paymentTotal;
  add('VENTAS', 'Valor total', amount(totalValue));

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
      settledValue: snapshot.restaurantClosedTablesTotal
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

module.exports = { summaryRows, legacyReport, summaryPdfSpec };
