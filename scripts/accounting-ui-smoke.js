const assert = require('node:assert/strict');
const { app } = require('../src/app');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/app/contabilidad`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /VantixGC Super Core/);
    assert.match(html, /Contabilidad PUC/);
    assert.match(html, /Panel administrativo/);
    assert.match(html, /\/api\/v1\/contabilidad\/cuentas/);
    assert.match(html, /x-tenant-subdomain/);

    console.log('ACCOUNTING UI SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
