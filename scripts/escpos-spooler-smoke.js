const assert = require('node:assert/strict');
const net = require('node:net');
const { RESTAURANT_COMMAND_LARGE_V2, buildEscPos, sendRawPrint, printBatch } = require('../edge/print-spooler/escpos');

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
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
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x21, 0x11])), 'table/station must use double width+height');
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x21, 0x01])), 'items and notes must use double height');
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x56, 0x00])));
    const kitchenText = kitchen.toString('utf8');
    assert.ok(kitchenText.includes('MESA 4'));
    assert.ok(kitchenText.includes('COCINA'));
    assert.ok(kitchenText.includes('2 x HAMBURGUESA'));
    assert.ok(kitchenText.includes('CAT: FUERTES'));
    assert.ok(kitchenText.includes('*** SIN CEBOLLA ***'));
    assert.ok(kitchenText.includes('>>> PERSONA 1 <<<'));
    assert.ok(kitchenText.includes('COMANDA ABC12345'));
    assert.equal(kitchenText.includes('$'), false, 'kitchen command must not print financial values');

    await sendRawPrint({ host: '127.0.0.1', port, buffer: kitchen });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(received.length, 1);
    assert.ok(received[0].toString('utf8').includes('HAMBURGUESA'));
    assert.ok(received[0].toString('utf8').includes('CAT: FUERTES'));

    const batch = await printBatch([
      { target: { name: 'Cocina', host: '127.0.0.1', port }, job: { title: 'COCINA', lines: ['1 x Plato fuerte'] } },
      { target: { name: 'Barra', host: '127.0.0.1', port }, job: { title: 'BARRA', lines: ['2 x Limonada'] } }
    ]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(batch.length, 2);
    assert.equal(batch.every((x) => x.ok), true);
    assert.equal(received.length, 3);
    const allText = Buffer.concat(received).toString('utf8');
    assert.ok(allText.includes('Plato fuerte'));
    assert.ok(allText.includes('Limonada'));

    console.log('ESC-POS LOCAL SPOOLER SMOKE OK');
    console.log(JSON.stringify({ rawTcp9100Compatible: true, escPosBytes: true, commandCategoryVisible: true, multiStationDirected: true, internetUsed: false, physicalPrinterTested: false }, null, 2));
  } finally { await close(printer); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
