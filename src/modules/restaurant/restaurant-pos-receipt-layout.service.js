'use strict';

const DEFAULT_COLUMNS_80 = 42;
const DEFAULT_COLUMNS_58 = 32;

function paperColumns(format) {
  const normalized = String(format || 'TERMICA_80').trim().toUpperCase();
  return normalized.includes('58') ? DEFAULT_COLUMNS_58 : DEFAULT_COLUMNS_80;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function wrapText(value, width) {
  const text = cleanText(value);
  const limit = Math.max(8, Number(width) || DEFAULT_COLUMNS_80);
  if (!text) return [];
  const lines = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf(' ', limit + 1);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    const line = remaining.slice(0, cut).trim();
    if (line) lines.push(line);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function centerLine(value, width) {
  const text = cleanText(value).slice(0, width);
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(left)}${text}`;
}

function centeredWrapped(value, width) {
  return wrapText(value, width).map((line) => centerLine(line, width));
}

function pairLine(leftValue, rightValue, width, minGap = 2) {
  const left = cleanText(leftValue);
  const right = cleanText(rightValue);
  if (!left) return right.slice(0, width).padStart(width, ' ');
  if (!right) return left.slice(0, width);
  const gap = Math.max(1, minGap);
  const availableLeft = width - right.length - gap;
  if (availableLeft < 8) return null;
  const clippedLeft = left.slice(0, availableLeft).trimEnd();
  return `${clippedLeft}${' '.repeat(Math.max(gap, width - clippedLeft.length - right.length))}${right}`;
}

function pairOrWrap(leftValue, rightValue, width, minGap = 2) {
  const oneLine = pairLine(leftValue, rightValue, width, minGap);
  if (oneLine) return [oneLine];
  return [
    ...wrapText(leftValue, width),
    cleanText(rightValue).slice(0, width).padStart(width, ' ')
  ].filter(Boolean);
}

function labelValueLines(label, value, width) {
  return pairOrWrap(label, value, width, 2);
}

function productLines(detail, { width, qty, money }) {
  const quantity = qty(detail?.cantidad);
  const description = cleanText(detail?.descripcion || 'Producto');
  const prefix = `${quantity} x `;
  const descriptionWidth = Math.max(8, width - prefix.length);
  const wrappedDescription = wrapText(description, descriptionWidth);
  const lines = [];
  if (wrappedDescription.length) {
    lines.push(`${prefix}${wrappedDescription[0]}`.slice(0, width));
    for (const continuation of wrappedDescription.slice(1)) lines.push(`  ${continuation}`.slice(0, width));
  } else {
    lines.push(`${prefix}Producto`.slice(0, width));
  }
  lines.push(...pairOrWrap(`${money(detail?.precioUnitario)} c/u`, money(detail?.totalLinea), width, 2));
  return lines;
}

function receiptLinesFullWidth({ company, sale, session, table, paperFormat, companyLines, money, qty, dateTime, number, defaultTitle }) {
  const width = paperColumns(paperFormat);
  const separator = '-'.repeat(width);
  const lines = [];

  lines.push(centerLine(String(company?.receiptTitle || defaultTitle).trim(), width));
  for (const companyLine of companyLines(company)) lines.push(...centeredWrapped(companyLine, width));
  if (lines.length > 1) lines.push(separator);

  const saleLabel = `Venta: ${sale?.numero || String(sale?.id || '').slice(0, 8).toUpperCase()}`;
  const tableLabel = `Mesa: ${table?.name || table?.code || 'Mesa'}`;
  lines.push(...pairOrWrap(saleLabel, tableLabel, width, 3));
  const when = dateTime(sale?.emitidoEn || session?.closedAt || sale?.fecha);
  if (when) lines.push(centerLine(`Fecha: ${when}`, width));
  lines.push(separator);

  for (const detail of Array.isArray(sale?.detalles) ? sale.detalles : []) {
    lines.push(...productLines(detail, { width, qty, money }));
  }

  lines.push(separator);
  lines.push(...labelValueLines('Subtotal', money(sale?.subtotal), width));
  if (number(sale?.descuentoTotal) > 0) lines.push(...labelValueLines('Descuento', money(sale.descuentoTotal), width));
  if (number(sale?.ivaTotal) > 0) lines.push(...labelValueLines('IVA', money(sale.ivaTotal), width));
  if (number(sale?.impoconsumoTotal) > 0) lines.push(...labelValueLines('Impoconsumo', money(sale.impoconsumoTotal), width));
  const tip = number(session?.tipAmount);
  if (tip > 0) lines.push(...labelValueLines('Propina', money(tip), width));
  lines.push(...labelValueLines('TOTAL', money(number(sale?.total) + tip), width));

  const payment = cleanText(session?.paymentMethodLabel || session?.paymentMethodKind || sale?.formaPago || '');
  if (payment) lines.push(...labelValueLines('Pago', payment, width));
  if (session?.paymentReference) lines.push(...labelValueLines('Ref', String(session.paymentReference).slice(0, 80), width));
  return lines;
}

module.exports = {
  DEFAULT_COLUMNS_80,
  DEFAULT_COLUMNS_58,
  paperColumns,
  cleanText,
  wrapText,
  centerLine,
  centeredWrapped,
  pairLine,
  pairOrWrap,
  labelValueLines,
  productLines,
  receiptLinesFullWidth
};
