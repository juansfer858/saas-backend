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
    assert.match(html, /VantixGC/);
    assert.match(html, /Plan de Cuentas \(PUC\)/);
    assert.match(html, /Libro Diario/);
    assert.match(html, /Comprobante Manual/);
    assert.match(html, /Libro Mayor \/ Auxiliar/);
    assert.match(html, /Reportes Financieros/);
    assert.match(html, /Balance de Prueba/);
    assert.match(html, /Estado de Resultados \(P&G\)/);
    assert.match(html, /\/api\/v1\/contabilidad\/asientos/);
    assert.match(html, /\/api\/v1\/contabilidad\/mayor/);
    assert.match(html, /x-tenant-subdomain/);

    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El módulo contable debe contener su controlador web');
    new Function(script);

    console.log('ACCOUNTING OPERATIONAL UI SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
