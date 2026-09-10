'use strict';

const fs = require('node:fs');
const displayName = require('../src/modules/restaurant/restaurant-customer-display-name');
const receipt = require('../src/modules/restaurant/restaurant-pos-receipt-layout.service');

const overlay = fs.readFileSync('src/web/restaurant-v2-cash-tender-v18.js', 'utf8');
const cashHtml = fs.readFileSync('src/web/restaurant-v2-cash.html', 'utf8');
const splitHtml = fs.readFileSync('src/web/restaurant-v2-split.html', 'utf8');
const cashRoutes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.routes.js', 'utf8');
const cashPublic = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js', 'utf8');
const splitPublic = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.public.routes.js', 'utf8');
const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');
const cashService = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.service.js', 'utf8');
const splitService = fs.readFileSync('src/modules/restaurant/restaurant-v2-split.service.js', 'utf8');
const receiptSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-layout.service.js', 'utf8');

function expect(value, message) {
  if (!value) throw new Error(message);
}

expect(displayName.normalizeCustomerName('') === 'Cliente genérico', 'el cliente por defecto debe ser Cliente genérico');
expect(displayName.normalizeCustomerName('  Juan   Pérez  ') === 'Juan Pérez', 'el nombre debe normalizar espacios');

const tagged = displayName.mergeCustomerNameObservation('SIN CEBOLLA\nMesa cumpleaños', 'Juan Pérez');
expect(tagged.includes('SIN CEBOLLA'), 'el nombre no puede borrar observaciones existentes');
expect(tagged.includes('[RESTAURANTE_CLIENTE] Juan Pérez'), 'falta etiqueta persistente de cliente');
const replaced = displayName.mergeCustomerNameObservation(tagged, 'Ana Gómez');
expect(!replaced.includes('Juan Pérez'), 'el nombre anterior debe reemplazarse');
expect((replaced.match(/\[RESTAURANTE_CLIENTE\]/g) || []).length === 1, 'no puede duplicarse la etiqueta de cliente');
const reset = displayName.mergeCustomerNameObservation(replaced, 'Cliente genérico');
expect(reset === 'SIN CEBOLLA\nMesa cumpleaños', 'Cliente genérico debe limpiar sólo la etiqueta interna');
expect(displayName.customerNameFromObservations(tagged) === 'Juan Pérez', 'no se recuperó el nombre persistido');
expect(displayName.customerNameFromObservations('Nota normal') === 'Cliente genérico', 'sin etiqueta debe usarse cliente genérico');

const commonReceipt = {
  company: {},
  session: { tipAmount: 0, paymentMethodLabel: 'Efectivo' },
  table: { name: 'Mesa 1' },
  paperFormat: 'TERMICA_80',
  companyLines: () => [],
  money: (v) => `$${Number(v || 0)}`,
  qty: (v) => String(v),
  dateTime: () => '10/09/2026 12:00',
  number: (v) => Number(v || 0),
  defaultTitle: 'Tirilla POS'
};
const namedLines = receipt.receiptLinesFullWidth({
  ...commonReceipt,
  sale: { numero: 'FV-1', observaciones: tagged, subtotal: 10000, total: 10000, detalles: [] }
});
expect(namedLines.some((line) => line.includes('Cliente') && line.includes('Juan Pérez')), 'la tirilla no imprime el nombre solicitado');
const genericLines = receipt.receiptLinesFullWidth({
  ...commonReceipt,
  sale: { numero: 'FV-2', observaciones: null, subtotal: 10000, total: 10000, detalles: [] }
});
expect(genericLines.some((line) => line.includes('Cliente') && line.includes('Cliente genérico')), 'la tirilla no usa cliente genérico por defecto');

expect(overlay.includes('VANTIX_RESTAURANT_V2_CASH_TENDER_V18'), 'falta marker V18');
expect(overlay.includes("const DEFAULT_CUSTOMER='Cliente genérico'"), 'falta cliente genérico en Caja');
expect(overlay.includes('Nombre del cliente'), 'falta campo Nombre del cliente');
expect(overlay.includes('Efectivo recibido'), 'falta Efectivo recibido');
expect(overlay.includes('Devolución'), 'falta Devolución');
expect(overlay.includes("parseMoney($('#billTotal')?.textContent)+Number($('#tipAmount')?.value||0)"), 'Caja debe calcular recibido contra cuenta + propina');
expect(overlay.includes("parseMoney($('#payPartAmount')?.textContent)"), 'División debe calcular recibido contra la parte exacta');
expect(overlay.includes('Math.max(0,received-due)'), 'falta cálculo de devolución');
expect(overlay.includes('received<due'), 'falta bloqueo por efectivo insuficiente');
expect(overlay.includes('body.customerName='), 'el nombre no viaja al cobro de Caja');
expect(!overlay.includes('body.cashReceived'), 'el efectivo recibido no debe enviarse como monto contable');
expect(!overlay.includes('body.cashChange'), 'la devolución no debe enviarse como monto contable');
expect(!overlay.includes('body.received='), 'el recibido no debe modificar el payload contable');
expect(overlay.includes('observer?.disconnect()'), 'el observador V18 debe desconectarse durante su propio repintado');
expect(overlay.includes('observer?.observe(document.documentElement,OBSERVER_OPTIONS)'), 'el observador V18 debe reconectarse de forma estable');

expect(cashRoutes.includes('customerName:'), 'chargeSchema no acepta nombre de cliente');
expect(cashRoutes.includes('stageCustomerNameForTable'), 'Caja no persiste el nombre antes del cierre');
expect(cashRoutes.includes('restoreCustomerNameIfDraft'), 'Caja no restaura el nombre si el cobro falla');
expect(receiptSource.includes("labelValueLines('Cliente'"), 'la tirilla no incluye la línea Cliente');

expect(cashHtml.includes('/app/restaurant-v2-cash-tender-v18.js?v=v18'), 'Caja no carga V18 desde su plantilla canónica');
expect(splitHtml.includes('/app/restaurant-v2-cash-tender-v18.js?v=v18'), 'División no carga V18 desde su plantilla canónica');
expect(cashPublic.includes("sendAsset(res, 'restaurant-v2-cash.html'"), 'la ruta canónica de Caja fue reemplazada innecesariamente');
expect(splitPublic.includes("sendAsset(res, 'restaurant-v2-split.html'"), 'la ruta canónica de División fue reemplazada innecesariamente');
expect(aggregator.includes("'/app/restaurant-v2-cash-tender-v18.js'"), 'falta ruta pública V18');

expect(cashService.includes('closeTableWithMethod'), 'Caja dejó de usar el cierre real existente');
expect(!cashService.includes('cashReceived'), 'el motor real de Caja no debe contabilizar recibido');
expect(splitService.includes('registerPartPaymentFinalized'), 'División dejó de amortizar la parte real existente');
expect(!splitService.includes('cashReceived'), 'el motor real de División no debe contabilizar recibido');

console.log('Restaurant V2 Cash Tender V18 smoke: OK');
