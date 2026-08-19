const accounting = require('./accounting.service');
const { AppError } = require('../../utils/app-error');

function scalar(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && typeof v.toString === 'function' && v.constructor?.name === 'Decimal') return v.toString();
  return String(v);
}

function reportRows(type, data) {
  if (type === 'diario') {
    return {
      title: 'Libro Diario',
      headers: ['Fecha', 'Comprobante', 'Concepto', 'Origen', 'Estado', 'Débito', 'Crédito'],
      rows: data.items.map((x) => [x.fecha, x.numeroComprobante || x.referencia || '', x.concepto, x.origen, x.estado, x.totalDebito, x.totalCredito])
    };
  }
  if (type === 'mayor') {
    return {
      title: `Libro Mayor - ${data.cuenta.codigo} ${data.cuenta.nombre}`,
      headers: ['Fecha', 'Comprobante', 'Concepto', 'Débito', 'Crédito', 'Saldo'],
      rows: data.movimientos.map((x) => [x.fecha, x.numeroComprobante || x.referencia || '', x.concepto, x.debito, x.credito, x.saldo])
    };
  }
  if (type === 'balance-prueba') {
    return {
      title: 'Balance de Prueba',
      headers: ['Código', 'Cuenta', 'Débito', 'Crédito', 'Saldo'],
      rows: data.cuentas.map((x) => [x.cuenta.codigo, x.cuenta.nombre, x.debito, x.credito, x.saldo])
    };
  }
  if (type === 'estado-resultados') {
    const rows = [];
    const pushAccounts = (label, list) => {
      rows.push([label, '', '']);
      for (const x of list) rows.push([x.cuenta.codigo, x.cuenta.nombre, x.valor]);
    };
    pushAccounts('Ingresos operacionales', data.cuentas.INGRESO_OPERACIONAL);
    rows.push(['', 'Ingresos operacionales', data.ingresosOperacionales]);
    pushAccounts('Costo de ventas', data.cuentas.COSTO_VENTAS);
    rows.push(['', 'Utilidad bruta', data.utilidadBruta]);
    pushAccounts('Gastos administración', data.cuentas.GASTO_ADMINISTRACION);
    pushAccounts('Gastos ventas', data.cuentas.GASTO_VENTAS);
    rows.push(['', 'Utilidad operacional', data.utilidadOperacional]);
    pushAccounts('Ingresos no operacionales', data.cuentas.INGRESO_NO_OPERACIONAL);
    pushAccounts('Gastos no operacionales', data.cuentas.GASTO_NO_OPERACIONAL);
    rows.push(['', 'Utilidad antes de impuestos', data.utilidadAntesImpuestos]);
    rows.push(['', data.impuestoEstimado ? 'Impuesto de renta estimado' : 'Impuesto de renta', data.impuestoRenta]);
    rows.push(['', 'Utilidad neta', data.utilidadNeta]);
    return { title: 'Estado de Resultados', headers: ['Código/Sección', 'Concepto', 'Valor'], rows };
  }
  if (type === 'balance-general') {
    const rows = [];
    const groups = [
      ['Activo corriente', 'ACTIVO_CORRIENTE'],
      ['Activo no corriente', 'ACTIVO_NO_CORRIENTE'],
      ['Pasivo corriente', 'PASIVO_CORRIENTE'],
      ['Pasivo no corriente', 'PASIVO_NO_CORRIENTE'],
      ['Patrimonio', 'PATRIMONIO']
    ];
    for (const [label, key] of groups) {
      rows.push([label, '', '']);
      for (const x of data.grupos[key]) rows.push([x.cuenta.codigo, x.cuenta.nombre, x.saldo]);
    }
    if (Number(data.utilidadEjercicioNoCerrada || 0) !== 0) rows.push(['', 'Utilidad del ejercicio no cerrada', data.utilidadEjercicioNoCerrada]);
    if (Number(data.impuestoEstimadoNoContabilizado || 0) !== 0) rows.push(['', 'Impuesto estimado no contabilizado', data.impuestoEstimadoNoContabilizado]);
    rows.push(['', 'Total Activo', data.totalActivo]);
    rows.push(['', 'Total Pasivo', data.totalPasivo]);
    rows.push(['', 'Total Pasivo + Patrimonio', data.totalPasivoPatrimonio]);
    rows.push(['', 'Diferencia', data.diferencia]);
    return { title: 'Estado de Situación Financiera', headers: ['Código/Sección', 'Concepto', 'Valor'], rows };
  }
  throw new AppError(400, 'Tipo de reporte no soportado', 'ACCOUNTING_EXPORT_TYPE_INVALID');
}

async function loadReport(tenantId, type, filters) {
  if (type === 'diario') return accounting.listJournals(tenantId, { ...filters, pageSize: 500 });
  if (type === 'mayor') return accounting.getLedger(tenantId, filters);
  if (type === 'balance-prueba') return accounting.getTrialBalance(tenantId, filters);
  if (type === 'estado-resultados') return accounting.getProfitAndLoss(tenantId, filters);
  if (type === 'balance-general') return accounting.getBalanceSheet(tenantId, filters);
  throw new AppError(400, 'Tipo de reporte no soportado', 'ACCOUNTING_EXPORT_TYPE_INVALID');
}

function escapeHtml(value) {
  return scalar(value).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

function toExcelHtml(spec) {
  const rows = spec.rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
  return Buffer.from(`\ufeff<html><head><meta charset="utf-8"></head><body><h2>${escapeHtml(spec.title)}</h2><table border="1"><thead><tr>${spec.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`, 'utf8');
}

function pdfEscape(s) {
  return scalar(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');
}

function toSimplePdf(spec) {
  const lines = [spec.title, '', spec.headers.join(' | '), ...spec.rows.map((r) => r.map(scalar).join(' | '))];
  const pageSize = 48;
  const pages = [];
  for (let i = 0; i < lines.length; i += pageSize) pages.push(lines.slice(i, i + pageSize));
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.set(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((page, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const text = page.map((line) => `(${pdfEscape(line).slice(0, 150)}) Tj T*`).join('\n');
    const stream = `BT /F1 8 Tf 36 806 Td 11 TL\n${text}\nET`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = [0];
  const maxId = Math.max(...objects.keys());
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = Buffer.byteLength(out, 'binary');
    out += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'binary');
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'binary');
}

async function exportReport(tenantId, type, format, filters) {
  const data = await loadReport(tenantId, type, filters);
  const spec = reportRows(type, data);
  if (format === 'xls') return { buffer: toExcelHtml(spec), mime: 'application/vnd.ms-excel', extension: 'xls', title: spec.title };
  if (format === 'pdf') return { buffer: toSimplePdf(spec), mime: 'application/pdf', extension: 'pdf', title: spec.title };
  throw new AppError(400, 'Formato de exportación no soportado', 'ACCOUNTING_EXPORT_FORMAT_INVALID');
}

module.exports = { exportReport, toExcelHtml, toSimplePdf, reportRows };
