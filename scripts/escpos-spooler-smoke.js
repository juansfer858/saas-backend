const assert = require('node:assert/strict');
const net = require('node:net');
const { ESC_POS_CP850_TABLE, encodeCp850, RESTAURANT_COMMAND_LARGE_V2, RESTAURANT_POS_RECEIPT_TYPE, buildEscPos, sendRawPrint, printBatch } = require('../edge/print-spooler/escpos');

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
  assert.equal(ESC_POS_CP850_TABLE, 2);
  assert.equal(RESTAURANT_POS_RECEIPT_TYPE, 'RESTAURANT_POS_V1');
  assert.deepEqual(
    Array.from(encodeCp850('áéíóúñÑ')),
    [0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5],
    'Spanish accents and ñ must be encoded as CP850 bytes'
  );
  assert.deepEqual(Array.from(encodeCp850('Dirección').slice(-2)), [0xa2, 0x6e]);
  assert.ok(encodeCp850('Teléfono').includes(0x82));

  const spanishReceipt = buildEscPos({
    receiptType: RESTAURANT_POS_RECEIPT_TYPE,
    title: 'Restaurante El Niño',
    lines: ['COMPROBANTE DE VENTA', 'Dirección: Carrera 10', 'Teléfono: 6041234567', 'Información válida'],
    cut: false
  });
  assert.ok(spanishReceipt.includes(Buffer.from([0x1b, 0x74, 0x02])), 'ESC/POS must select CP850 after reset');
  assert.ok(spanishReceipt.includes(Buffer.from([0x1b, 0x61, 0x01])), 'restaurant POS name must be centered');
  assert.ok(spanishReceipt.includes(Buffer.from([0x1b, 0x45, 0x01])), 'restaurant POS name must be bold');
  assert.ok(spanishReceipt.includes(Buffer.from([0x1d, 0x21, 0x11])), 'restaurant POS name must use double width+height');
  assert.ok(spanishReceipt.includes(Buffer.from([0x1d, 0x21, 0x00])), 'restaurant POS must reset text size after business name');
  assert.ok(spanishReceipt.includes(encodeCp850('Restaurante El Niño')));
  assert.ok(spanishReceipt.includes(encodeCp850('Dirección: Carrera 10')));
  assert.ok(spanishReceipt.includes(encodeCp850('Teléfono: 6041234567')));
  assert.equal(spanishReceipt.includes(Buffer.from('Dirección', 'utf8')), false, 'raw UTF-8 must not leak to ESC/POS printer');

  const genericReceipt = buildEscPos({ title: 'Documento genérico', lines: ['Normal'], cut: false });
  assert.equal(genericReceipt.includes(Buffer.from([0x1d, 0x21, 0x11])), false, 'non-restaurant generic documents must keep normal title size');

  const received = [];
  const printer = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => received.push(Buffer.concat(chunks)));
  });
  const port = await listen(printer);
  try {
    const kitchen = buildEscPos({
      template: RESTAURANT_COMMAND_LARGE_V2,
      tableLabel: 'Mesa 4',
      stationLabel: 'COCINA',
      createdAt: '2026-09-05T17:04:00.000Z',
      traceLabel: 'COMANDA ABC12345',
      paperFormat: 'TERMICA_80',
      lines: [{ quantity: 2, name: 'Hamburguesa\nCAT: FUERTES', category: 'FUERTES', note: 'sin cebolla', seatNumber: 1, seatLabel: 'PERSONA 1' }],
      cut: true
    });
    assert.equal(kitchen[0], 0x1b);
    assert.equal(kitchen[1], 0x40);
    assert.ok(kitchen.includes(Buffer.from([0x1b, 0x74, 0x02])), 'restaurant commands must select CP850 too');
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x21, 0x11])), 'table/station must use double width+height');
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x21, 0x01])), 'items and notes must use double height');
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x56, 0x00])));
    assert.ok(kitchen.includes(Buffer.from('MESA 4', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('COCINA', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('2 x HAMBURGUESA', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('CAT: FUERTES', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('*** SIN CEBOLLA ***', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('>>> PERSONA 1 <<<', 'ascii')));
    assert.ok(kitchen.includes(Buffer.from('COMANDA ABC12345', 'ascii')));
    assert.equal(kitchen.includes(Buffer.from('$', 'ascii')), false, 'kitchen command must not print financial values');

    await sendRawPrint({ host: '127.0.0.1', port, buffer: kitchen });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(received.length, 1);
    assert.ok(received[0].includes(Buffer.from('HAMBURGUESA', 'ascii')));
    assert.ok(received[0].includes(Buffer.from('CAT: FUERTES', 'ascii')));

    const batch = await printBatch([
      { target: { name: 'Cocina', host: '127.0.0.1', port }, job: { title: 'COCINA', lines: ['1 x Plato fuerte'] } },
      { target: { name: 'Barra', host: '127.0.0.1', port }, job: { title: 'BARRA', lines: ['2 x Limonada'] } }
    ]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(batch.length, 2);
    assert.equal(batch.every((x) => x.ok), true);
    assert.equal(received.length, 3);
    const all = Buffer.concat(received);
    assert.ok(all.includes(Buffer.from('Plato fuerte', 'ascii')));
    assert.ok(all.includes(Buffer.from('Limonada', 'ascii')));

    console.log('ESC-POS LOCAL SPOOLER CP850 + RESTAURANT POS BRANDING SMOKE OK');
    console.log(JSON.stringify({ rawTcp9100Compatible: true, escPosBytes: true, codePage: 'CP850', spanishAccents: true, enye: true, rawUtf8Blocked: true, restaurantPosBusinessNameCentered: true, restaurantPosBusinessNameBold: true, restaurantPosBusinessNameDoubleSize: true, genericDocumentsUnaffected: true, commandCategoryVisible: true, multiStationDirected: true, internetUsed: false, physicalPrinterTested: false }, null, 2));
  } finally { await close(printer); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
