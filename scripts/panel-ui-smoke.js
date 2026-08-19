const assert = require('node:assert/strict');
const { app } = require('../src/app');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const route of ['/app/dashboard', '/app/ventas', '/app/ventas/nueva', '/app/ventas/00000000-0000-0000-0000-000000000000', '/app/contabilidad']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /VantixGC Super Core/);
      assert.match(html, /Nueva venta/);
      assert.match(html, /Registrar abono/);
      assert.match(html, /Contabilidad PUC/);
    }

    console.log('SUPER CORE PANEL UI SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
