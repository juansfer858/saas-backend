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

    const dashboard = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    const loader = fs.readFileSync('src/web/panel-integration-extras.js', 'utf8');
    const routes = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
    const restaurantHtml = fs.readFileSync('src/web/restaurant.html', 'utf8');

    for (const marker of [
      'Exportar Excel', 'Exportar PDF', 'Actualizar', 'Resumen operativo ·',
      'data-dashboard-route', '/app/cartera', '/app/inventario', '/app/centro-de-control'
    ]) assert.ok(dashboard.includes(marker), `Falta interacción ${marker}`);

    assert.ok(dashboard.includes("session?.tenant?.nicho || 'CORE'"));
    assert.ok(dashboard.includes("window.VantixGCCoreDashboardOwner = 'panel-restaurant-entry.js'"));
    assert.ok(dashboard.includes('data-dashboard-actions="single-owner-v1"'));
    assert.ok(dashboard.includes('function installDashboardEvents()'));
    assert.ok(dashboard.includes('sessionStorage.setItem(ORIGIN_KEY'));
    assert.ok(dashboard.includes("fromLabel = 'Dashboard'"));
    assert.ok(dashboard.includes('data-core-origin-return'));
    assert.ok(dashboard.includes('← Atrás'));
    assert.ok(dashboard.includes('window.location.assign(destination)'));
    assert.ok(!dashboard.includes('history.back()'));
    assert.ok(!dashboard.includes('MutationObserver'));
    assert.ok(!dashboard.includes('setInterval'));

    // El Dashboard no depende del loader de integración ni de un runtime de
    // decoración posterior. Eso evita botones visibles sin listener.
    assert.ok(loader.includes('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js'));
    assert.ok(!loader.includes('dashboard-interactions.js'));
    assert.ok(!loader.includes('Exportar Excel'));
    assert.ok(routes.includes("router.get('/ventas/dashboard/exportar'"));
    assert.ok(!routes.includes('dashboard-interactions.js'));
    assert.equal(fs.existsSync('src/web/dashboard-interactions.js'), false);

    // El Core base conserva indicadores transversales y Restaurante aporta
    // únicamente sus indicadores propios cuando existe acceso.
    assert.ok(dashboard.includes("label: 'Productos activos'"));
    assert.ok(dashboard.includes("label: 'Stock crítico'"));
    assert.ok(dashboard.includes('const rows = restaurant ? ['));
    assert.ok(dashboard.includes("label: 'Mesas ocupadas'"));

    assert.ok(restaurantHtml.includes('vantixgc_core_origin_v1'));
    assert.ok(restaurantHtml.includes("origin.targetPath!=='/app/centro-de-control'"));
    assert.ok(restaurantHtml.includes("admin.textContent='← Volver a Administración'"));
    assert.ok(restaurantHtml.includes('data-restaurant-admin-link="true"'));

    new Function(dashboard);
    new Function(loader);

    console.log('UNIVERSAL DASHBOARD SINGLE OWNER + REPORTS + ORIGIN BACK SMOKE OK');
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
