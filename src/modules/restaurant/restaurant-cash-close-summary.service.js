'use strict';

// VANTIX_RESTAURANT_CASH_CLOSE_SUMMARY_V125
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

function normalizedDeliveryFees(report) {
  const source = report.deliveryFees || {};
  return {
    count:Math.max(0, Math.trunc(number(source.count))),
    billed:number(source.billed),
    collected:number(source.collected),
    cash:number(source.cash),
    transfer:number(source.transfer),
    card:number(source.card),
    credit:number(source.credit),
    other:number(source.other),
    bank:number(source.bank),
    pending:number(source.pending)
  };
}

function productionBreakdown(report) {
  const cocina = number(report.production?.COCINA?.value);
  const barra = number(report.production?.BARRA?.value);
  const postres = number(report.production?.POSTRES?.value);
  return { cocina, barra, postres, total:cocina + barra + postres };
}

function ownCloseReport(report) {
  const delivery = normalizedDeliveryFees(report);
  const payments = salesPayments(report);
  const production = productionBreakdown(report);
  const ownPayments = {
    cash:Math.max(0, payments.cash - delivery.cash),
    transfer:Math.max(0, payments.transfer - delivery.transfer),
    card:Math.max(0, payments.card - delivery.card),
    credit:Math.max(0, payments.credit - delivery.credit),
    other:Math.max(0, payments.other - delivery.other)
  };
  const ownSales = Math.max(0, number(report.totals?.billedValue) - delivery.billed);
  const covered = Object.values(ownPayments).reduce((sum, value) => sum + value, 0);
  return {
    base:number(report.cash?.openingBalance ?? report.shift?.saldoInicial),
    production,
    ownSales,
    productionDifference:ownSales - production.total,
    ownPayments,
    covered,
    collectionDifference:ownSales - covered,
    thirdParty:{
      count:delivery.count,
      billed:delivery.billed,
      collected:delivery.collected,
      cash:delivery.cash,
      bank:delivery.bank,
      pending:delivery.pending
    }
  };
}

// Legacy cross retained for compatibility with existing expense/report tests.
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
  const own = ownCloseReport(report);
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
  add('TURNO', 'BASE', amount(own.base));

  if (own.production.cocina !== 0) add('VENTAS RESTAURANTE', 'Cocina', amount(own.production.cocina));
  if (own.production.barra !== 0) add('VENTAS RESTAURANTE', 'Barra', amount(own.production.barra));
  if (own.production.postres !== 0) add('VENTAS RESTAURANTE', 'Postres', amount(own.production.postres));
  add('VENTAS RESTAURANTE', 'TOTAL VENTAS PROPIAS', amount(own.ownSales));
  add('VENTAS RESTAURANTE', 'Diferencia Producción / Ventas', amount(own.productionDifference));

  add('RECAUDO VENTAS PROPIAS', 'Efectivo restaurante', amount(own.ownPayments.cash));
  add('RECAUDO VENTAS PROPIAS', 'Transferencia / QR restaurante', amount(own.ownPayments.transfer));
  add('RECAUDO VENTAS PROPIAS', 'Tarjeta', amount(own.ownPayments.card));
  add('RECAUDO VENTAS PROPIAS', 'Crédito pendiente', amount(own.ownPayments.credit));
  if (own.ownPayments.other !== 0) add('RECAUDO VENTAS PROPIAS', 'Otros medios', amount(own.ownPayments.other));
  add('RECAUDO VENTAS PROPIAS', 'TOTAL CUBIERTO', amount(own.covered));
  add('RECAUDO VENTAS PROPIAS', 'Diferencia Ventas / Recaudo', amount(own.collectionDifference));

  if (own.thirdParty.count > 0 || own.thirdParty.billed !== 0 || own.thirdParty.collected !== 0) {
    add('FONDOS DE TERCEROS', `Cargos de domicilio cobrados (${own.thirdParty.count})`, amount(own.thirdParty.collected));
    add('FONDOS DE TERCEROS', 'Recibidos en efectivo', amount(own.thirdParty.cash));
    add('FONDOS DE TERCEROS', 'Recibidos por banco', amount(own.thirdParty.bank));
    add('FONDOS DE TERCEROS', 'TOTAL FONDOS DE TERCEROS', amount(own.thirdParty.collected));
    if (own.thirdParty.pending !== 0) add('FONDOS DE TERCEROS', 'Pendiente de recaudo', amount(own.thirdParty.pending));
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
    deliveryFees:snapshot.deliveryFees || null,
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
    },
    production:snapshot.production || null
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

module.exports = {
  summaryRows,
  legacyReport,
  summaryPdfSpec,
  salesPayments,
  normalizedExpenses,
  normalizedDeliveryFees,
  productionBreakdown,
  ownCloseReport,
  closeCross
};
