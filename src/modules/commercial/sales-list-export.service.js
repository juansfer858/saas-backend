const { prisma } = require('../../config/prisma');
const { toExcelHtml } = require('../accounting/accounting-export.service');
const sales = require('./sales.service');

function buildWhere(tenantId, filters = {}) {
  const where = { tenantId, tipo: 'FACTURA_VENTA' };
  if (filters.terceroId) where.terceroId = filters.terceroId;
  if (filters.estado) where.estado = filters.estado;
  if (filters.desde || filters.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(filters.desde.includes('T') ? filters.desde : `${filters.desde}T00:00:00.000Z`);
    if (filters.hasta) where.fecha.lte = new Date(filters.hasta.includes('T') ? filters.hasta : `${filters.hasta}T23:59:59.999Z`);
  }
  if (filters.montoMin !== undefined || filters.montoMax !== undefined) {
    where.total = {};
    if (filters.montoMin !== undefined && filters.montoMin !== '') where.total.gte = Number(filters.montoMin);
    if (filters.montoMax !== undefined && filters.montoMax !== '') where.total.lte = Number(filters.montoMax);
  }
  return where;
}

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

async function exportFilteredSales(tenantId, filters = {}) {
  const where = buildWhere(tenantId, filters);
  const docs = await prisma.comprobanteComercial.findMany({
    where,
    include: { tercero: true },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }]
  });
  const ids = docs.map((doc) => doc.id);
  const dianDocs = ids.length
    ? await prisma.dianDocument.findMany({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: { in: ids } } })
    : [];
  const dianByOrigin = new Map(dianDocs.map((row) => [row.originId, row]));

  const dataRows = docs.map((doc) => {
    const unpacked = sales.unpackMeta(doc.observaciones);
    return [
      doc.numero || '',
      dateStamp(doc.fecha),
      customerLabel(doc),
      doc.estado || '',
      dianLabel(dianByOrigin.get(doc.id)),
      paymentLabel(unpacked.formaPago || doc.formaPago),
      Number(doc.total || 0),
      Number(doc.saldo || 0)
    ];
  });

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
    filename: `Ventas_${filters.desde || 'inicio'}_${filters.hasta || 'hoy'}.xls`,
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

module.exports = { buildWhere, paymentLabel, exportFilteredSales };
