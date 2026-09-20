'use strict';

const customerDisplay = require('./restaurant-customer-display-name');

const DEFAULT_COLUMNS_80 = 42;
const DEFAULT_COLUMNS_58 = 32;
const DELIVERY_ADDRESS_SAFE_COLUMNS = 32;

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

function deliveryDetailLines(label, value, width) {
  const text = cleanText(value);
  if (!text) return [];
  const configuredWidth = Math.max(8, Number(width) || DEFAULT_COLUMNS_80);
  const safeWidth = Math.min(configuredWidth, DELIVERY_ADDRESS_SAFE_COLUMNS);
  return [`${cleanText(label)}:`, ...wrapText(text, safeWidth)];
}

function deliveryAddressLines(value, width) {
  return deliveryDetailLines('Dirección', value, width);
}

function customerName(sale) {
  return cleanText(sale?.tercero?.razonSocial)
    || cleanText(sale?.tercero?.nombre)
    || customerDisplay.customerNameFromObservations(sale?.observaciones);
}

function customerDocumentLabel(tercero) {
  const type = cleanText(tercero?.tipoDocumento).toUpperCase();
  if (type === 'NIT') return 'NIT';
  return type || 'Documento';
}

function enabled(template, key, fallback = true) {
  return template?.[key] === undefined ? fallback : Boolean(template[key]);
}

function customerDetailLines(sale, width, template = {}) {
  const tercero = sale?.tercero || null;
  const lines = [];
  if (enabled(template, 'showCustomerName')) {
    const name = customerName(sale);
    if (name) lines.push(...labelValueLines('Cliente', name, width));
  }
  if (!tercero) return lines;
  if (enabled(template, 'showCustomerDocument') && tercero.identificacion) lines.push(...labelValueLines(customerDocumentLabel(tercero), tercero.identificacion, width));
  if (enabled(template, 'showCustomerAddress') && tercero.direccion) lines.push(...deliveryDetailLines('Dirección', tercero.direccion, width));
  if (enabled(template, 'showCustomerPhone') && tercero.telefono) lines.push(...labelValueLines('Teléfono', tercero.telefono, width));
  if (enabled(template, 'showCustomerEmail') && tercero.email) lines.push(...deliveryDetailLines('Correo', tercero.email, width));
  return lines;
}

function companyTemplateLines(company, template = {}, width) {
  const lines = [];
  if (enabled(template, 'showCompanyName')) lines.push(...centeredWrapped(company?.nombreEmpresa || 'Restaurante', width));
  if (enabled(template, 'showNit') && company?.nit) lines.push(...centeredWrapped(`NIT: ${company.nit}`, width));
  if (enabled(template, 'showAddress') && company?.address) lines.push(...centeredWrapped(`Dirección: ${company.address}`, width));
  if (enabled(template, 'showCity') && (company?.city || company?.department)) lines.push(...centeredWrapped([company?.city, company?.department].filter(Boolean).join(' · '), width));
  if (enabled(template, 'showPhone') && company?.phone) lines.push(...centeredWrapped(`Tel: ${company.phone}`, width));
  if (enabled(template, 'showEmail') && company?.email) lines.push(...centeredWrapped(company.email, width));
  return lines;
}

function sameText(left, right) {
  return cleanText(left).toLocaleLowerCase('es-CO') === cleanText(right).toLocaleLowerCase('es-CO');
}

function formatDeliveryDateTime(value, timeZone, fallbackFormatter) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const zone = cleanText(timeZone);
  if (zone) {
    try {
      return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: zone
      }).format(date);
    } catch {}
  }
  return typeof fallbackFormatter === 'function' ? fallbackFormatter(value) : '';
}

function productLines(detail, { width, qty, money, showUnitPrice = true }) {
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
  if (showUnitPrice) lines.push(...pairOrWrap(`${money(detail?.precioUnitario)} c/u`, money(detail?.totalLinea), width, 2));
  else lines.push(cleanText(money(detail?.totalLinea)).slice(0, width).padStart(width, ' '));
  return lines;
}

function receiptLinesFullWidth({ company, sale, session, table, paperFormat, companyLines, money, qty, dateTime, number, defaultTitle, template = {} }) {
  const width = paperColumns(paperFormat);
  const separator = '-'.repeat(width);
  const lines = [];

  const title = cleanText(template?.title) || cleanText(company?.receiptTitle) || cleanText(defaultTitle);
  if (title) lines.push(centerLine(title, width));
  const useLegacyCompanyLines = !template || Object.keys(template).length === 0;
  if (useLegacyCompanyLines && typeof companyLines === 'function') {
    lines.push(...centeredWrapped(company?.nombreEmpresa || 'Restaurante', width));
    for (const companyLine of companyLines(company)) lines.push(...centeredWrapped(companyLine, width));
  } else {
    lines.push(...companyTemplateLines(company, template, width));
  }
  lines.push(separator);

  const saleLabel = `Venta: ${sale?.numero || String(sale?.id || '').slice(0, 8).toUpperCase()}`;
  const tableLabel = `Mesa: ${table?.name || table?.code || 'Mesa'}`;
  const showSale = enabled(template, 'showSaleNumber');
  const showTable = enabled(template, 'showTable');
  if (showSale && showTable) lines.push(...pairOrWrap(saleLabel, tableLabel, width, 3));
  else if (showSale) lines.push(...wrapText(saleLabel, width));
  else if (showTable) lines.push(...wrapText(tableLabel, width));

  const rawWhen = sale?.emitidoEn || session?.closedAt || sale?.fecha;
  const when = session?.deliveryTimeZone
    ? formatDeliveryDateTime(rawWhen, session.deliveryTimeZone, dateTime)
    : dateTime(rawWhen);
  if (enabled(template, 'showDate') && when) lines.push(centerLine(`Fecha: ${when}`, width));

  lines.push(...customerDetailLines(sale, width, template));
  if (enabled(template, 'showCustomerPhone') && session?.deliveryPhone && !sameText(session.deliveryPhone, sale?.tercero?.telefono)) lines.push(...labelValueLines('Teléfono', session.deliveryPhone, width));
  if (enabled(template, 'showCustomerAddress') && session?.deliveryAddress && !sameText(session.deliveryAddress, sale?.tercero?.direccion)) lines.push(...deliveryAddressLines(session.deliveryAddress, width));
  if (enabled(template, 'showCustomerAddress') && session?.deliveryNeighborhood) lines.push(...deliveryDetailLines('Barrio/Zona', session.deliveryNeighborhood, width));
  if (enabled(template, 'showCustomerAddress') && session?.deliveryReference) lines.push(...deliveryDetailLines('Referencia', session.deliveryReference, width));
  lines.push(separator);

  for (const detail of Array.isArray(sale?.detalles) ? sale.detalles : []) {
    lines.push(...productLines(detail, { width, qty, money, showUnitPrice:enabled(template, 'showUnitPrice') }));
  }

  lines.push(separator);
  if (enabled(template, 'showSubtotal')) lines.push(...labelValueLines('Subtotal', money(sale?.subtotal), width));
  if (enabled(template, 'showDiscount') && number(sale?.descuentoTotal) > 0) lines.push(...labelValueLines('Descuento', money(sale.descuentoTotal), width));
  if (enabled(template, 'showTaxes')) {
    if (number(sale?.ivaTotal) > 0) lines.push(...labelValueLines('IVA', money(sale.ivaTotal), width));
    if (number(sale?.impoconsumoTotal) > 0) lines.push(...labelValueLines('Impoconsumo', money(sale.impoconsumoTotal), width));
  }
  const tip = number(session?.tipAmount);
  if (enabled(template, 'showTip') && tip > 0) lines.push(...labelValueLines('Propina', money(tip), width));
  lines.push(...labelValueLines('TOTAL', money(number(sale?.total) + tip), width));

  const payment = cleanText(session?.paymentMethodLabel || session?.paymentMethodKind || sale?.formaPago || '');
  if (enabled(template, 'showPayment') && payment) lines.push(...labelValueLines('Pago', payment, width));
  if (enabled(template, 'showReference') && session?.paymentReference) lines.push(...labelValueLines('Ref', String(session.paymentReference).slice(0, 80), width));

  const footerText = cleanText(template?.footerText);
  if (footerText) {
    lines.push(separator);
    lines.push(...centeredWrapped(footerText, width));
  }
  return lines;
}

module.exports = {
  DEFAULT_COLUMNS_80,
  DEFAULT_COLUMNS_58,
  DELIVERY_ADDRESS_SAFE_COLUMNS,
  paperColumns,
  cleanText,
  wrapText,
  centerLine,
  centeredWrapped,
  pairLine,
  pairOrWrap,
  labelValueLines,
  deliveryDetailLines,
  deliveryAddressLines,
  customerName,
  customerDocumentLabel,
  enabled,
  customerDetailLines,
  companyTemplateLines,
  sameText,
  formatDeliveryDateTime,
  productLines,
  receiptLinesFullWidth
};
