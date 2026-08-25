const assert = require('node:assert/strict');
const queryService = require('../src/modules/commercial/sales-query.service');
const { prisma } = require('../src/config/prisma');

async function main() {
  try {
    const result = await queryService.dashboard('00000000-0000-0000-0000-000000000001', { tzOffsetMinutes: 300 });
    assert.equal(result.timezoneOffsetMinutes, 300);
    assert.equal(result.salesByDay.length, 7);
    assert.ok(Array.isArray(result.topProducts));
    assert.equal(Number(result.productSalesTotal), 0);
    assert.equal(Number(result.kpis.ventasHoy), 0);
    assert.equal(Number(result.kpis.ventasMes), 0);
    assert.equal(Number(result.kpis.ticketPromedio), 0);
    assert.equal(Number(result.kpis.carteraPendiente), 0);
    assert.equal(Number(result.indicators.productosActivos), 0);
    assert.equal(Number(result.indicators.stockCritico), 0);

    const fs = require('node:fs');
    const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    const css = fs.readFileSync('src/web/super-core-workspace-v6.css', 'utf8');
    const routes = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
    assert.ok(navigation.includes("const DASHBOARD_ANALYTICS_VERSION = 'core-dashboard-analytics-v2'"));
    assert.ok(navigation.includes("coreGet(`/api/v1/comercial/ventas/dashboard?tzOffsetMinutes=${encodeURIComponent(offset)}`)"));
    assert.ok(navigation.includes('Ventas últimos 7 días'));
    assert.ok(navigation.includes('Mix de productos'));
    assert.ok(navigation.includes('Top productos'));
    assert.ok(navigation.includes('Indicadores operativos'));
    assert.ok(!navigation.includes('+ Nueva venta'));
    assert.ok(css.includes('/* Real analytics dashboard V2 */'));
    assert.ok(css.includes('.core-dash-donut'));
    assert.ok(css.includes('.core-dash-bars'));
    assert.ok(routes.indexOf("router.get('/ventas/dashboard'") < routes.indexOf("router.get('/ventas/:id'"));

    console.log('DASHBOARD ANALYTICS V2 SMOKE OK');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
