const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const html = fs.readFileSync('src/web/restaurant-control-preview.html', 'utf8');
  const routes = `${fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8')}\n${fs.readFileSync('src/modules/restaurant/restaurant.public.routes.base.js', 'utf8')}`;
  const p12 = fs.readFileSync('src/modules/restaurant/restaurant-v2-only-p12.public.routes.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');

  // El artefacto histórico se conserva congelado para trazabilidad, pero P12 ya
  // no permite ejecutarlo como superficie operativa del SaaS.
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
  assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(html), 'Preview histórico debe permanecer read-only');
  assert.ok(!html.includes("fetch('/api/"), 'Preview API helper must always use auth/session headers');

  assert.match(routes, /\/app\/centro-de-control-preview/);
  assert.match(routes, /X-VantixGC-Restaurant-Control-Preview', 'real-readonly-v1'/);
  assert.match(routes, /X-VantixGC-Restaurant-Control-Writes', 'disabled'/);
  assert.match(p12, /\/app\/centro-de-control-preview/);
  assert.match(p12, /centro-de-control-preview/);
  assert.match(p12, /X-VantixGC-Restaurant-V1-Runtime/);

  // La única entrada de producto expuesta desde Super Core sigue siendo el
  // Centro de Control canónico, que P12 resuelve a V2 nativo.
  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control'/);
  assert.match(panelEntry, /data-restaurant-dashboard-entry/);
  assert.match(panelEntry, /openRestaurantControlCenter/);
  assert.ok(!panelEntry.includes('data-restaurant-classic-entry'));
  assert.ok(!panelEntry.includes('Panel clásico'));
  assert.ok(!panelEntry.includes('openRestaurantClassic'));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/app/centro-de-control-preview', { redirect:'manual' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), '/app/centro-de-control-v2');
    assert.equal(response.headers.get('x-vantixgc-restaurant-v2-only'), 'p12-v2-only-runtime');
    assert.equal(response.headers.get('x-vantixgc-restaurant-v1-runtime'), 'disabled');
    assert.equal(response.headers.get('x-vantixgc-restaurant-v1-redirect-from'), 'centro-de-control-preview');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT CONTROL PREVIEW RETIRED BY V2 ONLY P12 SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
