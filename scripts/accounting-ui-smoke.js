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
    for (const marker of [
      'VantixGC',
      'Plan de Cuentas',
      'Libro Diario',
      'Comprobante Manual',
      'Libro Mayor',
      'Reportes',
      'Terceros',
      'Periodos',
      'Impuestos',
      'Activos Fijos',
      'Conciliación',
      'Balance de Prueba',
      'Estado de Resultados',
      'Balance General / Situación Financiera',
      'Anular asiento',
      'Exportar a Excel',
      'Exportar a PDF',
      '/api/v1/contabilidad/reportes/balance-general',
      '/api/v1/contabilidad/periodos/',
      '/api/v1/contabilidad/impuestos/',
      '/api/v1/contabilidad/activos-fijos',
      '/api/v1/contabilidad/conciliaciones',
      'x-tenant-subdomain'
    ]) {
      assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El módulo contable debe contener su controlador web');
    new Function(script);

    console.log('ACCOUNTING V2 OPERATIONAL UI SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
