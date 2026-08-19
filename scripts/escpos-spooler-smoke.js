const assert = require('node:assert/strict');
const net = require('node:net');
const { buildEscPos, sendRawPrint, printBatch } = require('../edge/print-spooler/escpos');

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
    const kitchen = buildEscPos({ title: 'COCINA · Mesa 4', lines: [{ quantity: 2, name: 'Hamburguesa', note: 'sin cebolla' }], footer: 'Pedido #123' });
    assert.equal(kitchen[0], 0x1b);
    assert.equal(kitchen[1], 0x40);
    assert.ok(kitchen.includes(Buffer.from([0x1d, 0x56, 0x00])));

    await sendRawPrint({ host: '127.0.0.1', port, buffer: kitchen });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(received.length, 1);
    assert.ok(received[0].toString('utf8').includes('Hamburguesa'));

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
    console.log(JSON.stringify({ rawTcp9100Compatible: true, escPosBytes: true, multiStationDirected: true, internetUsed: false, physicalPrinterTested: false }, null, 2));
  } finally { await close(printer); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
