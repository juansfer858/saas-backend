'use strict';

const { decimal, money, qty } = require('../../utils/decimal');

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function canonical(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(canonical).filter(Boolean).sort().join('~');
  if (typeof value === 'object') {
    return Object.keys(value).sort().map((key) => `${normalizeText(key)}:${canonical(value[key])}`).join('|');
  }
  return normalizeText(value);
}

function priceKey(value) {
  return money(value || 0).toFixed(2);
}

function operationalLineKey(line = {}, options = {}) {
  const includeState = options.includeState !== false;
  const includeSource = options.includeSource !== false;
  const productIdentity = line.menuItemId || line.productId || line.productoId || line.sku || line.description || line.descripcion || '';
  const variant = line.variantId ?? line.variant ?? line.presentationId ?? line.presentation ?? line.presentacion ?? '';
  const modifiers = line.modifiers ?? line.modificadores ?? line.options ?? line.opciones ?? '';
  const notes = line.notes ?? line.nota ?? line.instrucciones ?? '';
  const unitPrice = line.unitPrice ?? line.precioUnitario ?? line.appliedUnitPrice ?? line.precioAplicado ?? 0;
  const station = line.station ?? line.estacion ?? '';
  const state = includeState ? (line.orderState ?? line.state ?? line.estado ?? '') : '';
  const source = includeSource ? (line.source ?? line.origen ?? '') : '';
  return [
    normalizeText(productIdentity),
    canonical(variant),
    canonical(modifiers),
    normalizeText(notes),
    priceKey(unitPrice),
    normalizeText(station),
    normalizeText(state),
    normalizeText(source)
  ].join('||');
}

function groupOperationalLines(lines = [], options = {}) {
  const groups = new Map();
  for (const raw of Array.isArray(lines) ? lines : []) {
    const key = operationalLineKey(raw, options);
    let group = groups.get(key);
    const seat = Number(raw.seatNumber || 0);
    if (!group) {
      group = {
        ...raw,
        quantity: qty(raw.quantity || raw.cantidad || 0),
        lineTotal: money(raw.lineTotal ?? raw.totalLinea ?? 0),
        seatNumbers: [],
        sourceItemIds: []
      };
      groups.set(key, group);
    } else {
      group.quantity = qty(decimal(group.quantity).plus(raw.quantity || raw.cantidad || 0));
      group.lineTotal = money(decimal(group.lineTotal).plus(raw.lineTotal ?? raw.totalLinea ?? 0));
    }
    if (Number.isInteger(seat) && seat > 0 && !group.seatNumbers.includes(seat)) group.seatNumbers.push(seat);
    if (raw.id && !group.sourceItemIds.includes(raw.id)) group.sourceItemIds.push(raw.id);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    seatNumbers: group.seatNumbers.sort((a, b) => a - b),
    seatLabels: group.seatNumbers.sort((a, b) => a - b).map((seat) => `Persona ${seat}`)
  }));
}

function sameOperationalLine(a, b, options = {}) {
  return operationalLineKey(a, options) === operationalLineKey(b, options);
}

module.exports = {
  normalizeText,
  canonical,
  priceKey,
  operationalLineKey,
  groupOperationalLines,
  sameOperationalLine
};
