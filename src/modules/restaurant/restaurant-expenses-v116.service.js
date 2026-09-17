'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const treasuryIntegration = require('../treasury/treasury-integration.service');
const { toExcelHtml } = require('../accounting/accounting-export.service');
const posReceiptPrint = require('./restaurant-pos-receipt-print.service');

const MARKER = 'VANTIX_RESTAURANT_EXPENSES_DAILY_SALES_V116';
const DEFAULT_TZ_OFFSET_MINUTES = 300;
const originalBuildCashCloseSnapshot = posReceiptPrint.buildCashCloseSnapshot;

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TZ_OFFSET_MINUTES;
  return Math.min(Math.max(Math.trunc(parsed), -840), 840);
}

function businessDate(value = new Date(), offset = DEFAULT_TZ_OFFSET_MINUTES) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - normalizeOffset(offset) * 60000).toISOString().slice(0, 10);
}

function assertDay(value) {
  const day = String(value || businessDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(400, 'Fecha inválida', 'RESTAURANT_EXPENSE_DATE_INVALID');
  return day;
}

function dayWindow(day, offset = DEFAULT_TZ_OFFSET_MINUTES) {
  const normalized = assertDay(day);
  const start = new Date(`${normalized}T00:00:00.000Z`);
  start.setTime(start.getTime() + normalizeOffset(offset) * 60000);
  return { gte: start, lte: new Date(start.getTime() + 86400000 - 1) };
}

function amount(value) { return money(value || 0); }
function publicAccount(row) {
  if (!row) return null;
  return { id: row.id, nombre: row.nombre, tipo: row.tipo, banco: row.banco || null, numeroCuenta: row.numeroCuenta || null, saldoActual: amount(row.saldoActual).toString() };
}
function publicShift(row) {
  if (!row) return null;
  return { id: row.id, cajaBancoId: row.cajaBancoId, abiertoEn: row.abiertoEn, saldoInicial: amount(row.saldoInicial).toString(), ingresosEfectivo: amount(row.ingresosEfectivo).toString(), egresosEfectivo: amount(row.egresosEfectivo).toString(), cajaBanco: publicAccount(row.cajaBanco) };
}
function publicExpense(row) {
  return {
    id: row.id,
    numero: row.numero,
    concepto: row.observaciones || 'Gasto',
    valor: amount(row.total).toString(),
    medio: row.cajaBanco?.tipo === 'CAJA' ? 'EFECTIVO' : 'TRANSFERENCIA',
    cuenta: row.cajaBanco?.nombre || null,
    cajaBancoId: row.cajaBancoId || null,
    fecha: row.fecha,
    creadoEn: row.creadoEn
  };
}

async function openShift(tenantId, userId, client = prisma) {
  return client.aperturaCierreCaja.findFirst({
    where: { tenantId, userId, estado: 'ABIERTA' },
    include: { cajaBanco: true },
    orderBy: { abiertoEn: 'desc' }
  });
}

async function context(tenantId, userId, client = prisma) {
  const [shift, banks] = await Promise.all([
    openShift(tenantId, userId, client),
    client.cajaBanco.findMany({ where: { tenantId, activo: true, tipo: 'BANCO' }, orderBy: { nombre: 'asc' } })
  ]);
  return {
    marker: MARKER,
    businessDate: businessDate(),
    shift: publicShift(shift),
    cashAccount: shift?.cajaBanco?.tipo === 'CAJA' ? publicAccount(shift.cajaBanco) : null,
    bankAccounts: banks.map(publicAccount)
  };
}

async function expenseRowsForWindow(tenantId, userId, window, client = prisma) {
  return client.comprobanteComercial.findMany({
    where: {
      tenantId,
      tipo: 'COMPROBANTE_EGRESO',
      numero: { startsWith: 'GD-' },
      creadoPorId: userId,
      estado: { not: 'ANULADO' },
      creadoEn: window
    },
    include: { cajaBanco: true },
    orderBy: { creadoEn: 'asc' }
  });
}

async function listDay(tenantId, userId, date, client = prisma) {
  const day = assertDay(date);
  const rows = await expenseRowsForWindow(tenantId, userId, dayWindow(day), client);
  return {
    marker: MARKER,
    businessDate: day,
    items: rows.map(publicExpense),
    totals: expenseTotals(rows)
  };
}

function expenseTotals(rows) {
  let cash = decimal(0); let transfer = decimal(0);
  for (const row of rows || []) {
    if (row.cajaBanco?.tipo === 'CAJA') cash = cash.plus(row.total || 0);
    else if (row.cajaBanco?.tipo === 'BANCO') transfer = transfer.plus(row.total || 0);
  }
  return {
    cash: money(cash).toString(),
    transfer: money(transfer).toString(),
    total: money(cash.plus(transfer)).toString(),
    count: (rows || []).length
  };
}

async function createExpense(tenantId, userId, input, client = prisma) {
  const concepto = String(input.concepto || '').trim();
  if (!concepto) throw new AppError(400, 'Indique el concepto del gasto', 'RESTAURANT_EXPENSE_CONCEPT_REQUIRED');
  const value = amount(input.monto);
  if (!value.gt(0)) throw new AppError(400, 'El valor del gasto debe ser mayor que cero', 'RESTAURANT_EXPENSE_AMOUNT_INVALID');
  const method = String(input.medio || '').trim().toUpperCase();
  if (!['EFECTIVO', 'TRANSFERENCIA'].includes(method)) throw new AppError(400, 'Seleccione Efectivo o Transferencia', 'RESTAURANT_EXPENSE_METHOD_INVALID');

  const shift = await openShift(tenantId, userId, client);
  if (!shift) throw new AppError(409, 'Abra su turno de Caja antes de registrar gastos del restaurante', 'RESTAURANT_EXPENSE_SHIFT_REQUIRED');

  let accountId = shift.cajaBancoId;
  if (method === 'EFECTIVO') {
    if (shift.cajaBanco?.tipo !== 'CAJA') throw new AppError(409, 'El turno abierto no pertenece a una caja de efectivo', 'RESTAURANT_EXPENSE_CASH_SHIFT_INVALID');
  } else {
    const bank = await client.cajaBanco.findFirst({ where: { id: input.cajaBancoId, tenantId, activo: true, tipo: 'BANCO' } });
    if (!bank) throw new AppError(400, 'Seleccione una cuenta bancaria activa', 'RESTAURANT_EXPENSE_BANK_REQUIRED');
    accountId = bank.id;
  }

  const result = await treasuryIntegration.directExpense(tenantId, userId, {
    cajaBancoId: accountId,
    monto: value,
    concepto,
    fecha: new Date(),
    sourceId: `${MARKER}-${crypto.randomUUID()}`
  });
  const row = await client.comprobanteComercial.findFirst({
    where: { id: result.documento.id, tenantId },
    include: { cajaBanco: true }
  });
  return { marker: MARKER, shiftId: shift.id, expense: publicExpense(row) };
}

async function expenseSummaryForShift(tenantId, shift, client = prisma) {
  if (!shift?.id || !shift?.userId || !shift?.abiertoEn) return { cash:'0.00', transfer:'0.00', total:'0.00', count:0, rows:[] };
  const end = shift.cerradoEn ? new Date(shift.cerradoEn) : new Date();
  const rows = await expenseRowsForWindow(tenantId, shift.userId, { gte:new Date(shift.abiertoEn), lte:end }, client);
  const totals = expenseTotals(rows);
  return { ...totals, rows: rows.map(publicExpense) };
}

// The cash-close history reads the returned shift object into its immutable snapshot.
// Enriching the canonical snapshot here preserves the expense totals without changing
// Treasury, Accounting, Sales or the historical C86 persistence contract.
if (!posReceiptPrint.__restaurantExpensesV116Patched) {
  posReceiptPrint.buildCashCloseSnapshot = async function buildCashCloseSnapshotV116(tenantId, shiftId, client = prisma) {
    const base = await originalBuildCashCloseSnapshot(tenantId, shiftId, client);
    if (!base?.shift) return base;
    const expenseSummary = await expenseSummaryForShift(tenantId, base.shift, client);
    return { ...base, shift: { ...base.shift, expenseSummary } };
  };
  Object.defineProperty(posReceiptPrint, '__restaurantExpensesV116Patched', { value: true, enumerable: false });
}

function normalizePaymentMethod(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (upper.includes('EFECTIVO')) return 'Efectivo';
  if (upper.includes('TRANSFER') || upper.includes('QR') || upper === 'BANCO') return 'Transferencia / QR';
  if (upper.includes('TARJETA')) return 'Tarjeta';
  if (upper.includes('CREDITO') || upper.includes('CRÉDITO')) return 'Crédito';
  return raw ? raw.replaceAll('_', ' ') : 'Sin registro';
}

async function snapshotsForDay(tenantId, userId, date, client = prisma) {
  const day = assertDay(date);
  const history = require('./restaurant-shift-close-history-c86.service');
  const auditRows = await client.auditoriaContable.findMany({
    where: { tenantId, entidad: history.AUDIT_ENTITY, accion: history.SNAPSHOT_ACTION },
    orderBy: { creadoEn: 'desc' },
    take: 1500
  });
  const byShift = new Map();
  for (const row of auditRows) {
    const snapshot = history.snapshotFromAudit(row);
    if (snapshot?.businessDate === day && !byShift.has(snapshot.shift.id)) byShift.set(snapshot.shift.id, snapshot);
  }
  const shifts = await client.aperturaCierreCaja.findMany({
    where: { tenantId, estado: 'CERRADA' },
    select: { id:true, abiertoEn:true },
    orderBy: { cerradoEn:'desc' },
    take: 1500
  });
  for (const shift of shifts) {
    if (byShift.has(shift.id) || history.businessDate(shift.abiertoEn, DEFAULT_TZ_OFFSET_MINUTES) !== day) continue;
    const snapshot = await history.ensureSnapshot(tenantId, userId, shift.id, { tzOffsetMinutes:DEFAULT_TZ_OFFSET_MINUTES }, client);
    byShift.set(shift.id, snapshot);
  }
  return [...byShift.values()];
}

function localStamp(value, offset = DEFAULT_TZ_OFFSET_MINUTES) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - normalizeOffset(offset) * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

function dailySalesRows(snapshots) {
  const sales = new Map();
  const methods = new Map();
  for (const snapshot of snapshots || []) {
    const complete = snapshot.complete || {};
    for (const collection of complete.collections || []) {
      if (!collection?.saleId || collection.priorInvoice) continue;
      if (!methods.has(collection.saleId)) methods.set(collection.saleId, new Set());
      methods.get(collection.saleId).add(normalizePaymentMethod(collection.method));
    }
    for (const sale of complete.sales || []) if (sale?.id && !sales.has(sale.id)) sales.set(sale.id, sale);
  }

  const rows = [];
  let total = decimal(0);
  for (const sale of [...sales.values()].sort((a,b) => String(a.at || '').localeCompare(String(b.at || '')))) {
    const methodSet = methods.get(sale.id);
    const method = methodSet?.size ? [...methodSet].join(' + ') : normalizePaymentMethod(sale.method);
    const items = Array.isArray(sale.items) && sale.items.length ? sale.items : [{ product:'Venta sin detalle', quantity:'1', unitPrice:sale.total, total:sale.total }];
    for (const item of items) {
      const lineTotal = amount(item.total);
      total = total.plus(lineTotal);
      rows.push({
        at: localStamp(sale.at),
        document: sale.number || '',
        customer: sale.customer || 'Cliente genérico',
        description: item.product || 'Producto',
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        value: Number(lineTotal),
        paymentMethod: method
      });
    }
  }
  return { rows, total: money(total).toString(), saleCount:sales.size };
}

async function dailySalesReport(tenantId, userId, date, client = prisma) {
  const day = assertDay(date);
  const snapshots = await snapshotsForDay(tenantId, userId, day, client);
  if (!snapshots.length) throw new AppError(409, 'El informe se habilita después de cerrar al menos un turno de este día', 'RESTAURANT_DAILY_SALES_CLOSE_REQUIRED');
  const data = dailySalesRows(snapshots);
  const rows = data.rows.map(row => [row.at,row.document,row.customer,row.description,row.quantity,row.unitPrice,row.value,row.paymentMethod]);
  rows.push(['','','','TOTAL','','',Number(data.total),'']);
  const spec = {
    title: `Ventas del día ${day}`,
    headers: ['Fecha / hora','Documento','Cliente','Descripción','Cantidad','Valor unitario','Valor','Medio de pago'],
    columns: [
      {label:'Fecha / hora',width:.14,type:'text',align:'left'},
      {label:'Documento',width:.11,type:'text',align:'left'},
      {label:'Cliente',width:.16,type:'text',align:'left'},
      {label:'Descripción',width:.22,type:'text',align:'left'},
      {label:'Cantidad',width:.08,type:'number',align:'right'},
      {label:'Valor unitario',width:.10,type:'number',align:'right'},
      {label:'Valor',width:.09,type:'number',align:'right'},
      {label:'Medio de pago',width:.10,type:'text',align:'left'}
    ],
    rows,
    rowStyles:[...data.rows.map(()=>'data'),'grand-total']
  };
  return { marker:MARKER, businessDate:day, saleCount:data.saleCount, lineCount:data.rows.length, total:data.total, buffer:toExcelHtml(spec), filename:`Ventas_${day}.xls` };
}

module.exports = {
  MARKER,
  DEFAULT_TZ_OFFSET_MINUTES,
  businessDate,
  dayWindow,
  context,
  listDay,
  createExpense,
  expenseSummaryForShift,
  normalizePaymentMethod,
  dailySalesRows,
  dailySalesReport
};
