const assert = require('node:assert/strict');
const { app } = require('../src/app');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/app/demo');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Modo demo de estructura/);
    assert.match(html, /Ventas/);
    assert.match(html, /Inventarios \/ Kardex/);
    assert.match(html, /Tesorería & Bancos/);
    assert.match(html, /Contabilidad PUC/);
    assert.match(html, /SOLO DEMO/);
    console.log('SUPER CORE DEMO UI SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
