const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const report = require('../src/modules/commercial/dashboard-report.service');

async function main() {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      nombreEmpresa: `Papelería QA ${stamp}`,
      nit: `900-${stamp}`,
      subdomain: `papeleria-${stamp}`,
      nicho: 'PAPELERIA',
      pais: 'CO',
      moneda: 'COP'
    }
  });

  try {
    const excel = await report.exportDashboard(tenant.id, 'excel', { tzOffsetMinutes: 300 });
    assert.equal(excel.extension, 'xls');
    assert.equal(excel.mime, 'application/vnd.ms-excel');
    const excelText = excel.buffer.toString('utf8');
    assert.ok(excelText.includes('IDENTIFICACIÓN DEL INFORME'));
    assert.ok(excelText.includes('RESUMEN EJECUTIVO'));
    assert.ok(excelText.includes('VENTAS ÚLTIMOS 7 DÍAS'));
    assert.ok(excelText.includes('TOP PRODUCTOS DEL MES'));
    assert.ok(excelText.includes('INDICADORES DEL NEGOCIO'));
    assert.ok(excelText.includes('PAPELERIA'));

    const pdf = await report.exportDashboard(tenant.id, 'pdf', { tzOffsetMinutes: 300 });
    assert.equal(pdf.extension, 'pdf');
    assert.equal(pdf.mime, 'application/pdf');
    assert.equal(pdf.buffer.subarray(0, 4).toString('ascii'), '%PDF');

    const interactions = fs.readFileSync('src/web/dashboard-interactions.js', 'utf8');
    const loader = fs.readFileSync('src/web/panel-integration-extras.js', 'utf8');
    const routes = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
    const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');

    for (const marker of [
      'Exportar Excel', 'Exportar PDF', 'Informes', 'Actualizar',
      'Resumen operativo ·', 'core-dash-actionable', '/app/cartera',
      '/app/inventario', '/app/centro-de-control'
    ]) assert.ok(interactions.includes(marker), `Falta interacción ${marker}`);

    assert.ok(interactions.includes("tenant.nicho || 'CORE'"));
    assert.ok(loader.includes('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js'));
    assert.ok(loader.includes('/api/v1/comercial/ui-runtime/dashboard-interactions.js'));
    assert.ok(routes.includes("router.get('/ventas/dashboard/exportar'"));
    assert.ok(routes.includes("router.get('/ui-runtime/dashboard-interactions.js'"));
    assert.ok(routes.indexOf("router.get('/ventas/dashboard/exportar'") < routes.indexOf("router.get('/ventas/:id'"));

    // El Core base siempre conserva indicadores transversales. Restaurante sólo
    // aporta indicadores propios cuando existe acceso a ese vertical.
    assert.ok(navigation.includes("label: 'Productos activos'"));
    assert.ok(navigation.includes("label: 'Stock crítico'"));
    assert.ok(navigation.includes("const rows = restaurant ? ["));
    assert.ok(navigation.includes("label: 'Mesas ocupadas'"));

    console.log('UNIVERSAL DASHBOARD + INTERACTIVE REPORTS SMOKE OK');
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
