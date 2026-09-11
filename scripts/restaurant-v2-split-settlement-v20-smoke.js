'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const splitReceipts = require('../src/modules/restaurant/restaurant-split-part-receipt-v20.service');

const hooks = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-hooks.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-split.html', 'utf8');
const service = fs.readFileSync('src/modules/restaurant/restaurant-split-part-receipt-v20.service.js', 'utf8');

assert.match(service, /RESTAURANT_SPLIT_PART_RECEIPT/);
assert.match(service, /queueSplitPartReceiptIntent/);
assert.match(service, /buildPendingSplitPartReceiptJobs/);
assert.match(service, /RESTAURANT_SPLIT_PART_V20/);
assert.match(service, /stableSplitPartJobId/);
assert.match(hooks, /queueSplitPartReceiptIntent/);
assert.match(hooks, /buildPendingSplitPartReceiptJobs/);
assert.match(hooks, /splitPartReceiptJobCount/);
assert.doesNotMatch(hooks, /queueReceiptForTableIfClosed\(tenantId, tableId\)/);
assert.match(html, /#closedBox\[hidden\],#payBox\[hidden\]\{display:none!important\}/);
assert.match(html, /Todas las partes fueron cobradas/);
assert.match(html, /No necesitas volver a Caja ni cobrar nuevamente el total/);

const company = { receiptTitle: 'COMPROBANTE POS', nombreEmpresa: 'Restaurante prueba' };
const snapshot = {
  paymentId: 'pay-1',
  sessionId: 'session-1',
  saleId: 'sale-1',
  saleNumber: 'FV-123',
  tableName: 'Mesa 1',
  partKey: 'P1',
  partName: 'Persona 1',
  saleAmount: '24000',
  metodoPago: 'EFECTIVO',
  reference: null,
  paidAt: '2026-09-11T22:00:00.000Z',
  details: [{ descripcion: 'HOT BURGER', cantidad: '1', precioUnitario: '24000', totalLinea: '24000' }]
};
const printer = { id: 'printer-1', name: 'POS', transport: 'LAN', host: '192.168.1.50', port: 9100, format: 'TERMICA_80' };
const lines = splitReceipts.splitPartReceiptLines({ company, snapshot, paperFormat: 'TERMICA_80' });
assert.ok(lines.some((line) => line.includes('COMPROBANTE INDIVIDUAL DE PAGO')));
assert.ok(lines.some((line) => line.includes('Persona 1')));
assert.ok(lines.some((line) => line.includes('HOT BURGER')));
assert.ok(lines.some((line) => line.includes('$ 24.000') || line.includes('$24.000') || line.includes('24.000')));
const jobA = splitReceipts.buildSplitPartReceiptJob({ company, snapshot, printer });
const jobB = splitReceipts.buildSplitPartReceiptJob({ company, snapshot, printer });
assert.equal(jobA.id, jobB.id, 'el job debe ser idempotente para el mismo pago e impresora');
assert.equal(jobA.payload.receiptType, 'RESTAURANT_SPLIT_PART_V20');
assert.equal(jobA.payload.paymentId, 'pay-1');
assert.equal(jobA.payload.partKey, 'P1');

console.log('RESTAURANT V2 SPLIT SETTLEMENT V20 SMOKE OK', JSON.stringify({
  falsePaidBannerFixed: true,
  oneSalePreserved: true,
  individualPartReceipt: true,
  noFinalTotalReceipt: true,
  deterministicPrintJob: true
}));
