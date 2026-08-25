const accounting = require('./accounting.service');
const { AppError } = require('../../utils/app-error');

function scalar(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && typeof v.toString === 'function' && v.constructor?.name === 'Decimal') return v.toString();
  return String(v);
}

function numberValue(v) {
  const n = Number(scalar(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function dateValue(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return scalar(v);
  return d.toISOString().slice(0, 10);
}

function sum(list, selector) {
  return (list || []).reduce((acc, item) => acc + numberValue(selector(item)), 0);
}

function makeSpec(title, columns, rows, rowStyles = []) {
  const headers = columns.map((column) => column.label);
  const normalizedStyles = rows.map((_, index) => rowStyles[index] || 'data');
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new AppError(500, `Fila inválida en reporte ${title}`, 'ACCOUNTING_EXPORT_ROW_SHAPE_INVALID');
    }
  }
  return { title, headers, columns, rows, rowStyles: normalizedStyles };
}

const COL = {
  date: (label, width) => ({ label, width, type: 'date', align: 'left' }),
  text: (label, width) => ({ label, width, type: 'text', align: 'left' }),
  number: (label, width) => ({ label, width, type: 'number', align: 'right' })
};

function reportRows(type, data) {
  if (type === 'diario') {
    const items = data.items || [];
    const rows = items.map((x) => [
      x.fecha,
      x.numeroComprobante || x.referencia || '',
      x.concepto || '',
      x.origen || '',
      x.estado || '',
      x.totalDebito,
      x.totalCredito
    ]);
    rows.push(['', '', 'TOTALES', '', '', sum(items, (x) => x.totalDebito), sum(items, (x) => x.totalCredito)]);
    return makeSpec('Libro Diario', [
      COL.date('Fecha', 0.12),
      COL.text('Comprobante', 0.14),
      COL.text('Concepto', 0.28),
      COL.text('Origen', 0.12),
      COL.text('Estado', 0.10),
      COL.number('Débito', 0.12),
      COL.number('Crédito', 0.12)
    ], rows, [...items.map(() => 'data'), 'grand-total']);
  }

  if (type === 'mayor') {
    const movimientos = data.movimientos || [];
    const rows = [[
      '', '', 'SALDO INICIAL', '', '', '', data.saldoInicial
    ]];
    const styles = ['subtotal'];
    for (const x of movimientos) {
      rows.push([
        x.fecha,
        x.numeroComprobante || x.referencia || '',
        x.concepto || '',
        x.tercero?.nombre || x.terceroNombre || '',
        x.debito,
        x.credito,
        x.saldo
      ]);
      styles.push('data');
    }
    rows.push(['', '', 'SALDO FINAL', '', '', '', data.saldoFinal]);
    styles.push('grand-total');
    return makeSpec(`Libro Mayor - ${data.cuenta.codigo} ${data.cuenta.nombre}`, [
      COL.date('Fecha', 0.11),
      COL.text('Comprobante', 0.13),
      COL.text('Concepto', 0.25),
      COL.text('Tercero', 0.19),
      COL.number('Débito', 0.11),
      COL.number('Crédito', 0.11),
      COL.number('Saldo', 0.10)
    ], rows, styles);
  }

  if (type === 'balance-prueba') {
    const cuentas = data.cuentas || [];
    const rows = cuentas.map((x) => [x.cuenta.codigo, x.cuenta.nombre, x.debito, x.credito, x.saldo]);
    rows.push(['', 'TOTALES', data.totalDebito, data.totalCredito, data.diferencia]);
    return makeSpec('Balance de Prueba', [
      COL.text('Código', 0.14),
      COL.text('Cuenta', 0.38),
      COL.number('Débito', 0.16),
      COL.number('Crédito', 0.16),
      COL.number('Saldo / Diferencia', 0.16)
    ], rows, [...cuentas.map(() => 'data'), 'grand-total']);
  }

  if (type === 'estado-resultados') {
    const rows = [];
    const styles = [];
    const addSection = (label, list, totalLabel, totalValue) => {
      rows.push([label, '', '', '']);
      styles.push('section');
      for (const x of list || []) {
        rows.push(['', x.cuenta.codigo, x.cuenta.nombre, x.valor]);
        styles.push('data');
      }
      rows.push(['Subtotal', '', totalLabel, totalValue]);
      styles.push('subtotal');
    };

    addSection('Ingresos operacionales', data.cuentas.INGRESO_OPERACIONAL, 'Ingresos operacionales', data.ingresosOperacionales);
    addSection('Costo de ventas', data.cuentas.COSTO_VENTAS, 'Costo de ventas', data.costoVentas);
    rows.push(['Resultado', '', 'UTILIDAD BRUTA', data.utilidadBruta]); styles.push('grand-total');
    addSection('Gastos de administración', data.cuentas.GASTO_ADMINISTRACION, 'Gastos de administración', data.gastosAdministracion);
    addSection('Gastos de ventas', data.cuentas.GASTO_VENTAS, 'Gastos de ventas', data.gastosVentas);
    rows.push(['Resultado', '', 'UTILIDAD OPERACIONAL', data.utilidadOperacional]); styles.push('grand-total');
    addSection('Ingresos no operacionales', data.cuentas.INGRESO_NO_OPERACIONAL, 'Ingresos no operacionales', data.ingresosNoOperacionales);
    addSection('Gastos no operacionales', data.cuentas.GASTO_NO_OPERACIONAL, 'Gastos no operacionales', data.gastosNoOperacionales);
    rows.push(['Resultado', '', 'UTILIDAD ANTES DE IMPUESTOS', data.utilidadAntesImpuestos]); styles.push('grand-total');
    rows.push(['Impuesto', '', data.impuestoEstimado ? 'Impuesto de renta estimado' : 'Impuesto de renta', data.impuestoRenta]); styles.push('subtotal');
    rows.push(['Resultado', '', 'UTILIDAD NETA', data.utilidadNeta]); styles.push('grand-total');

    return makeSpec('Estado de Resultados', [
      COL.text('Sección', 0.20),
      COL.text('Código', 0.13),
      COL.text('Cuenta / Concepto', 0.45),
      COL.number('Valor', 0.22)
    ], rows, styles);
  }

  if (type === 'balance-general') {
    const rows = [];
    const styles = [];
    const groups = [
      ['Activo corriente', 'ACTIVO_CORRIENTE'],
      ['Activo no corriente', 'ACTIVO_NO_CORRIENTE'],
      ['Pasivo corriente', 'PASIVO_CORRIENTE'],
      ['Pasivo no corriente', 'PASIVO_NO_CORRIENTE'],
      ['Patrimonio', 'PATRIMONIO']
    ];

    for (const [label, key] of groups) {
      const list = data.grupos[key] || [];
      rows.push([label, '', '', '']);
      styles.push('section');
      for (const x of list) {
        rows.push(['', x.cuenta.codigo, x.cuenta.nombre, x.saldo]);
        styles.push('data');
      }
      rows.push(['Subtotal', '', `Total ${label}`, sum(list, (x) => x.saldo)]);
      styles.push('subtotal');
    }

    if (numberValue(data.utilidadEjercicioNoCerrada) !== 0) {
      rows.push(['Ajuste', '', 'Utilidad del ejercicio no cerrada', data.utilidadEjercicioNoCerrada]);
      styles.push('subtotal');
    }
    if (numberValue(data.impuestoEstimadoNoContabilizado) !== 0) {
      rows.push(['Ajuste', '', 'Impuesto estimado no contabilizado', data.impuestoEstimadoNoContabilizado]);
      styles.push('subtotal');
    }

    for (const [label, value] of [
      ['TOTAL ACTIVO', data.totalActivo],
      ['TOTAL PASIVO', data.totalPasivo],
      ['PATRIMONIO', data.patrimonio],
      ['TOTAL PASIVO + PATRIMONIO', data.totalPasivoPatrimonio],
      ['DIFERENCIA', data.diferencia]
    ]) {
      rows.push(['Resumen', '', label, value]);
      styles.push('grand-total');
    }

    return makeSpec('Estado de Situación Financiera', [
      COL.text('Sección', 0.20),
      COL.text('Código', 0.13),
      COL.text('Cuenta / Concepto', 0.45),
      COL.number('Saldo', 0.22)
    ], rows, styles);
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

function excelCellValue(value, column) {
  if (column.type === 'date') return escapeHtml(dateValue(value));
  if (column.type === 'number') return escapeHtml(numberValue(value));
  return escapeHtml(value);
}

function toExcelHtml(spec) {
  const columns = spec.columns || spec.headers.map((label) => COL.text(label, 1 / spec.headers.length));
  const colgroup = `<colgroup>${columns.map((column) => `<col style="width:${Math.round(column.width * 100)}%">`).join('')}</colgroup>`;
  const header = `<thead><tr>${columns.map((column) => `<th class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>`;
  const body = spec.rows.map((row, rowIndex) => {
    const style = spec.rowStyles?.[rowIndex] || 'data';
    return `<tr class="${style}">${row.map((value, colIndex) => {
      const column = columns[colIndex];
      const cls = column.align === 'right' ? 'num' : '';
      return `<td class="${cls}">${excelCellValue(value, column)}</td>`;
    }).join('')}</tr>`;
  }).join('');

  const html = `\ufeff<html><head><meta charset="utf-8"><style>
  body{font-family:"Segoe UI",Arial,sans-serif;color:#1f2937;background:#fff;margin:18px}
  h1{font-size:20px;margin:0 0 4px}p.meta{color:#6b7280;font-size:11px;margin:0 0 14px}
  table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px}
  th,td{border:1px solid #d1d5db;padding:6px 7px;vertical-align:middle;overflow:hidden}
  th{background:#1f2937;color:#fff;font-weight:700;text-align:left}
  .num{text-align:right;mso-number-format:"#,##0.00"}
  tr.section td{background:#eff6ff;color:#1d4ed8;font-weight:700}
  tr.subtotal td{background:#fff7ed;color:#9a3412;font-weight:700}
  tr.grand-total td{background:#ecfdf5;color:#166534;font-weight:800}
  </style></head><body><h1>${escapeHtml(spec.title)}</h1><p class="meta">VantixGC Super Core · Reporte estructurado por columnas</p><table>${colgroup}${header}<tbody>${body}</tbody></table></body></html>`;
  return Buffer.from(html, 'utf8');
}

function pdfEscape(value) {
  return scalar(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\xFF]/g, '?');
}

function formatPdfCell(value, column) {
  if (column.type === 'date') return dateValue(value);
  if (column.type === 'number') {
    return new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue(value));
  }
  return scalar(value);
}

function truncateText(value, width, fontSize) {
  const text = scalar(value).replace(/[\r\n\t]+/g, ' ');
  const maxChars = Math.max(3, Math.floor((width - 8) / (fontSize * 0.52)));
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 3))}...`;
}

function textX(text, x, width, align, fontSize) {
  if (align === 'right') return x + width - 5 - Math.min(width - 10, text.length * fontSize * 0.52);
  if (align === 'center') return x + Math.max(4, (width - text.length * fontSize * 0.52) / 2);
  return x + 5;
}

function rgb(color) {
  const value = color.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255).map((n) => n.toFixed(3)).join(' ');
}

function pdfText(text, x, y, size, font = 'F1', color = '#1f2937') {
  return `BT /${font} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`;
}

function pdfRect(x, y, width, height, fill, stroke = '#d1d5db') {
  const commands = ['q'];
  if (fill) commands.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  commands.push(`${rgb(stroke)} RG 0.45 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`, 'Q');
  return commands.join('\n');
}

function rowPalette(style) {
  if (style === 'section') return { fill: '#eff6ff', text: '#1d4ed8', font: 'F2' };
  if (style === 'subtotal') return { fill: '#fff7ed', text: '#9a3412', font: 'F2' };
  if (style === 'grand-total') return { fill: '#ecfdf5', text: '#166534', font: 'F2' };
  return { fill: '#ffffff', text: '#1f2937', font: 'F1' };
}

function toSimplePdf(spec) {
  const columns = spec.columns || spec.headers.map((label) => COL.text(label, 1 / spec.headers.length));
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 28;
  const tableWidth = pageWidth - marginX * 2;
  const titleY = 558;
  const tableTop = 515;
  const rowHeight = 18;
  const footerY = 18;
  const bottomY = 42;
  const rowsPerPage = Math.max(1, Math.floor((tableTop - bottomY - rowHeight) / rowHeight));
  const widths = columns.map((column) => tableWidth * column.width);
  const pages = [];
  for (let i = 0; i < spec.rows.length; i += rowsPerPage) pages.push(spec.rows.slice(i, i + rowsPerPage));
  if (!pages.length) pages.push([]);

  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects.set(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((pageRows, pageIndex) => {
    const pageId = 5 + pageIndex * 2;
    const contentId = pageId + 1;
    const commands = [];
    commands.push(pdfText(spec.title, marginX, titleY, 14, 'F2', '#111827'));
    commands.push(pdfText('VantixGC Super Core - Reporte estructurado por columnas', marginX, titleY - 17, 7.5, 'F1', '#6b7280'));

    let x = marginX;
    const headerBottom = tableTop - rowHeight;
    columns.forEach((column, index) => {
      const width = widths[index];
      commands.push(pdfRect(x, headerBottom, width, rowHeight, '#1f2937', '#1f2937'));
      const label = truncateText(column.label, width, 7.2);
      commands.push(pdfText(label, textX(label, x, width, column.align, 7.2), headerBottom + 5.2, 7.2, 'F2', '#ffffff'));
      x += width;
    });

    pageRows.forEach((row, localIndex) => {
      const globalIndex = pageIndex * rowsPerPage + localIndex;
      const style = spec.rowStyles?.[globalIndex] || 'data';
      const palette = rowPalette(style);
      const bottom = headerBottom - (localIndex + 1) * rowHeight;
      let cellX = marginX;
      row.forEach((value, colIndex) => {
        const column = columns[colIndex];
        const width = widths[colIndex];
        commands.push(pdfRect(cellX, bottom, width, rowHeight, palette.fill));
        const text = truncateText(formatPdfCell(value, column), width, 7);
        const tx = textX(text, cellX, width, column.align, 7);
        commands.push(pdfText(text, tx, bottom + 5.1, 7, palette.font, palette.text));
        cellX += width;
      });
    });

    commands.push(pdfText(`Página ${pageIndex + 1} de ${pages.length}`, marginX, footerY, 7, 'F1', '#6b7280'));
    const stream = commands.join('\n');
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
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
