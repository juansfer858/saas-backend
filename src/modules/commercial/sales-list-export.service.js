const { AppError } = require('../../utils/app-error');
const { toExcelHtml } = require('../accounting/accounting-export.service');
const queryService = require('./sales-query.service');

const PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 50000;

function paymentLabel(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'EFECTIVO') return 'Efectivo';
  if (raw === 'BANCO' || raw.includes('TRANSFER') || raw.includes('QR')) return 'Transferencia / QR';
  if (raw === 'CREDITO' || raw === 'CRÉDITO') return 'Crédito';
  return raw ? raw.replaceAll('_', ' ') : 'Sin registro';
}

function dianLabel(row) {
  if (!row) return 'No encolado';
  const type = String(row.documentType || '').replaceAll('_', ' ');
  return [type, row.state].filter(Boolean).join(' · ') || 'Encolado';
}

function customerLabel(row) {
  return row?.tercero?.razonSocial || row?.tercero?.nombre || 'Consumidor final';
}

function dateStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function loadAllFiltered(tenantId, filters = {}) {
  const first = await queryService.list(tenantId, { ...filters, page: 1, pageSize: PAGE_SIZE });
  const total = Number(first.meta?.total || first.items.length || 0);
  if (total > MAX_EXPORT_ROWS) {
    throw new AppError(413, 'El filtro devuelve demasiadas ventas. Reduzca el rango de fechas antes de exportar.', 'SALES_EXPORT_RANGE_TOO_LARGE');
  }
  const items = [...first.items];
  const pages = Math.max(Number(first.meta?.pages || 1), 1);
  for (let page = 2; page <= pages; page += 1) {
    const next = await queryService.list(tenantId, { ...filters, page, pageSize: PAGE_SIZE });
    items.push(...next.items);
  }
  return items;
}

function safeDatePart(value, fallback) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

async function exportFilteredSales(tenantId, filters = {}) {
  const docs = await loadAllFiltered(tenantId, filters);
  const dataRows = docs.map((doc) => [
    doc.numero || '',
    dateStamp(doc.fecha),
    customerLabel(doc),
    doc.estado || '',
    dianLabel(doc.dianDocument),
    paymentLabel(doc.formaPago),
    Number(doc.total || 0),
    Number(doc.saldo || 0)
  ]);

  const total = docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0);
  const balance = docs.reduce((sum, doc) => sum + Number(doc.saldo || 0), 0);
  const rows = [...dataRows, ['', '', '', '', '', 'TOTALES', total, balance]];
  const columns = [
    { label:'Número', width:.10, type:'text', align:'left' },
    { label:'Fecha', width:.11, type:'date', align:'left' },
    { label:'Cliente', width:.22, type:'text', align:'left' },
    { label:'Estado', width:.12, type:'text', align:'left' },
    { label:'DIAN', width:.16, type:'text', align:'left' },
    { label:'Medio de pago', width:.13, type:'text', align:'left' },
    { label:'Total', width:.08, type:'number', align:'right' },
    { label:'Saldo', width:.08, type:'number', align:'right' }
  ];
  const titleParts = ['Ventas'];
  if (filters.desde && filters.hasta) titleParts.push(`${filters.desde} a ${filters.hasta}`);
  else if (filters.desde) titleParts.push(`desde ${filters.desde}`);
  else if (filters.hasta) titleParts.push(`hasta ${filters.hasta}`);

  return {
    filename: `Ventas_${safeDatePart(filters.desde, 'inicio')}_${safeDatePart(filters.hasta, 'hoy')}.xls`,
    count: docs.length,
    buffer: toExcelHtml({
      title: titleParts.join(' · '),
      headers: columns.map((column) => column.label),
      columns,
      rows,
      rowStyles: [...dataRows.map(() => 'data'), 'grand-total']
    })
  };
}

module.exports = { paymentLabel, loadAllFiltered, exportFilteredSales };
