'use strict';

const assert = require('node:assert/strict');
const { buildEscPos, RESTAURANT_COMMAND_LARGE_V2 } = require('../edge/print-spooler/escpos');

const buffer = buildEscPos({
  template: RESTAURANT_COMMAND_LARGE_V2,
  tableLabel: 'DOMICILIO D-TEST',
  stationLabel: 'COCINA',
  createdAt: '2026-09-12T20:00:00.000Z',
  traceLabel: 'COMANDA TEST1234',
  paperFormat: 'TERMICA_80',
  lines: [{ quantity: 1, name: 'HAMBURGUESA', note: 'SIN CEBOLLA' }],
  cut: true
});

const feed = Buffer.from([0x1b, 0x64, 0x05]); // ESC d 5 = avance físico de 5 líneas
const cut = Buffer.from([0x1d, 0x56, 0x00]);
const feedIndex = buffer.indexOf(feed);
const cutIndex = buffer.indexOf(cut);

assert.ok(feedIndex >= 0, 'La comanda debe avanzar papel físicamente antes del corte');
assert.ok(cutIndex > feedIndex, 'El avance debe ocurrir antes de la orden de corte');
assert.ok(buffer.includes(Buffer.from('COMANDA TEST1234', 'ascii')), 'La última zona de texto debe existir antes del avance seguro');

console.log(JSON.stringify({ ok:true, template:RESTAURANT_COMMAND_LARGE_V2, cutterFeedLines:5, feedBeforeCut:true }));
