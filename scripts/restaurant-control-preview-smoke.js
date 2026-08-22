const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const html = fs.readFileSync('src/web/restaurant-control-preview.html', 'utf8');
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');

  assert.match(html, /Centro de control/);
  assert.match(html, /Tu restaurante, bajo control/);
  assert.match(html, /Caja · Cobrar \/ Cerrar/);
  assert.match(html, /Vista cliente publicada/);
  assert.match(html, /Requiere tu atención/);
  assert.match(html, /Operación en vivo/);
  assert.match(html, /\/api\/v1\/restaurante\/ui-context/);
  assert.match(html, /\/api\/v1\/restaurante\/mesas/);
  assert.match(html, /\/api\/v1\/restaurante\/menu/);
  assert.match(html, /\/api\/v1\/restaurante\/comandas/);
  assert.match(html, /\/api\/v1\/restaurante\/pedidos/);
  assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(html), 'Preview must remain read-only');
  assert.ok(!html.includes("fetch('/api/"), 'Preview API helper must always use auth/session headers');

  assert.match(routes, /\/app\/centro-de-control-preview/);
  assert.match(routes, /X-VantixGC-Restaurant-Control-Preview', 'real-readonly-v1'/);
  assert.match(routes, /X-VantixGC-Restaurant-Control-Writes', 'disabled'/);

  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control-preview'/);
  assert.match(panelEntry, /CLASSIC_RESTAURANT_PATH = '\/app\/restaurante'/);
  assert.match(panelEntry, /data-restaurant-dashboard-entry/);
  assert.match(panelEntry, /data-restaurant-classic-entry/);
  assert.match(panelEntry, /Panel clásico/);
  assert.match(panelEntry, /openRestaurantControlCenter/);
  assert.match(panelEntry, /openRestaurantClassic/);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/app/centro-de-control-preview');
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-vantixgc-restaurant-control-preview'), 'real-readonly-v1');
    assert.equal(response.headers.get('x-vantixgc-restaurant-control-writes'), 'disabled');
    assert.match(body, /PREVIEW · lecturas reales, sin escrituras/);
    assert.match(body, /restaurant_cash_shift/);
    assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT CONTROL CENTER REVERSIBLE LAYER SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
