'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/web/sales.html', 'utf8');

assert.match(source, /VANTIX_SALES_DOCUMENT_DETAIL_REPRINT_V1/);
assert.match(source, /Detalle del documento/);
assert.match(source, /<th>Cant\.<\/th>/);
assert.match(source, /<th>Descripción<\/th>/);
assert.match(source, /Valor unitario/);
assert.match(source, /Valor total/);
assert.match(source, /COPIA \/ REIMPRESIÓN/);
assert.match(source, /id=\"reprintDocument\"/);
assert.match(source, /line\.descripcion/);
assert.match(source, /line\.precioUnitario/);
assert.match(source, /lineTotal\(line\)/);

const scriptMatch = source.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'sales.html debe conservar su script principal');
assert.doesNotThrow(() => new Function(scriptMatch[1]), 'el JavaScript de Ventas debe compilar');

const reprintMatch = source.match(/function printDocumentCopy\(x\)\{([\s\S]*?)\}\nasync function openDetail/);
assert.ok(reprintMatch, 'debe existir la función aislada de reimpresión');
const reprintSource = reprintMatch[1];
assert.match(reprintSource, /window\.open/);
assert.match(reprintSource, /popup\.print/);
assert.doesNotMatch(reprintSource, /\bapi\s*\(/, 'reimprimir no debe invocar APIs');
assert.doesNotMatch(reprintSource, /\bfetch\s*\(/, 'reimprimir no debe enviar solicitudes');
assert.doesNotMatch(reprintSource, /emitir|anular|pagos|caja\/recibo/i, 'reimprimir no debe tocar emisión ni cobros');

console.log('SALES DOCUMENT DETAIL REPRINT V1 SMOKE OK', JSON.stringify({
  fullDocumentDetail: true,
  historicalDescription: true,
  quantity: true,
  unitPrice: true,
  lineTotal: true,
  browserPrintCopy: true,
  noAccountingMutation: true,
  noPaymentMutation: true
}));
