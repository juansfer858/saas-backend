const assert = require('node:assert/strict');
const { app } = require('../src/app');
const { prisma } = require('../src/config/prisma');
const { ensureDemoTenant } = require('./ensure-production-demo-tenant');
const { seedDemoAccountingOperations } = require('./seed-demo-accounting-operations');
const { signAccessToken } = require('../src/utils/jwt');

async function main() {
  await ensureDemoTenant();
  await seedDemoAccountingOperations();

  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'demo-core' } });
  assert.ok(tenant, 'demo-core debe existir');
  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'admin@demo-core.vantixgc.com', activo: true }
  });
  assert.ok(admin, 'admin demo-core debe existir');

  const token = signAccessToken({ userId: admin.id, tenantId: tenant.id, rol: admin.rol });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-tenant-subdomain': 'demo-core'
  };

  async function get(path) {
    const response = await fetch(base + path, { headers });
    let body = {};
    try { body = await response.json(); } catch {}
    assert.equal(response.status, 200, `${path} debe responder 200. Respuesta: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true, `${path} debe responder ok=true`);
    return body;
  }

  try {
    // Bug 1: el selector debe recibir todas las auxiliares habilitadas, no una cuenta fija.
    const accounts = (await get('/api/v1/contabilidad/cuentas?limit=3000')).data || [];
    const movementAccounts = accounts.filter((a) => a.activa !== false && a.permiteMovimiento === true);
    assert.ok(movementAccounts.length >= 10, `PUC con movimiento insuficiente: ${movementAccounts.length}`);
    for (const code of ['110505', '130505', '220505', '413505', '519595', '613505']) {
      assert.ok(movementAccounts.some((a) => a.codigo === code), `Falta cuenta auxiliar ${code}`);
    }
    assert.ok(new Set(movementAccounts.map((a) => a.id)).size === movementAccounts.length, 'El selector no debe repetir la misma cuenta');

    // Bug 2: Libro Diario.
    const journals = (await get('/api/v1/contabilidad/asientos?pageSize=300')).data || [];
    assert.ok(journals.length >= 3, 'Libro Diario debe devolver los asientos demo');
    for (const journal of journals.slice(0, 10)) {
      assert.equal(Number(journal.totalDebito), Number(journal.totalCredito), `Asiento ${journal.id} descuadrado`);
    }

    // Bug 3: Impuestos y configuración fiscal.
    await get('/api/v1/contabilidad/configuracion');
    const vat = (await get('/api/v1/contabilidad/impuestos/iva')).data || [];
    const retentions = (await get('/api/v1/contabilidad/impuestos/retenciones')).data || [];
    assert.ok(Array.isArray(vat), 'IVA debe devolver arreglo');
    assert.ok(Array.isArray(retentions), 'Retenciones debe devolver arreglo');

    // Bug 4: Conciliación. Lista vacía es válida; 404/500 no lo es.
    const reconciliations = (await get('/api/v1/contabilidad/conciliaciones')).data || [];
    assert.ok(Array.isArray(reconciliations), 'Conciliaciones debe devolver arreglo');

    // Recursos del loadBase: ninguno puede tumbar la carga del PUC.
    const baseResources = [
      '/api/v1/terceros?limit=1000',
      '/api/v1/contabilidad/tipos-comprobante',
      '/api/v1/contabilidad/activos-fijos',
      '/api/v1/tesoreria/cajas-bancos',
      '/api/v1/contabilidad/periodos?limit=120'
    ];
    for (const path of baseResources) await get(path);

    // La página debe cargar la capa de resiliencia y servir el JS de guard.
    const page = await fetch(base + '/app/contabilidad');
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /accounting-runtime-guard\.js\?v=qa-blockers-v2/);

    const guard = await fetch(base + '/app/accounting-runtime-guard.js?v=qa-blockers-v2');
    const guardCode = await guard.text();
    assert.equal(guard.status, 200);
    assert.match(guardCode, /Promise\.allSettled/);
    assert.match(guardCode, /Error al cargar esta vista/);
    assert.match(guardCode, /permiteMovimiento === true/);
    assert.match(guardCode, /await renderDiario\(\)/);
    assert.match(guardCode, /await renderTaxes\(\)/);
    assert.match(guardCode, /await renderReconciliation\(\)/);
    new Function(guardCode);

    console.log('ACCOUNTING QA BLOCKERS SMOKE OK');
    console.log(JSON.stringify({
      cuentasMovimiento: movementAccounts.length,
      libroDiario: journals.length,
      iva: vat.length,
      retenciones: retentions.length,
      conciliaciones: reconciliations.length,
      cargaBaseAislada: true,
      loadingErrorFallback: true
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try { await prisma.$disconnect(); } catch {}
  process.exitCode = 1;
});
