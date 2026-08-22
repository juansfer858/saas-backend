const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
  const appSource = fs.readFileSync('src/app.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
  const shellJs = fs.readFileSync('src/web/restaurant-control-center.js', 'utf8');
  const shellCss = fs.readFileSync('src/web/restaurant-control-center.css', 'utf8');
  const restaurantHtml = fs.readFileSync('src/web/restaurant.html', 'utf8');
  const operationalEngine = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');

  assert.match(routes, /\/app\/centro-de-control/);
  assert.match(routes, /operational-shell-v1/);
  assert.match(routes, /restaurant-ui-v1/);
  assert.match(routes, /restaurant-control-center\.css/);
  assert.match(routes, /restaurant-control-center\.js/);

  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control'/);
  assert.ok(!panelEntry.includes('CLASSIC_RESTAURANT_PATH'));
  assert.ok(!panelEntry.includes('Panel clásico'));
  assert.ok(!panelEntry.includes('openRestaurantClassic'));

  assert.match(appSource, /href: '\/app\/centro-de-control', icon: '🍽', label: 'Restaurante'/);
  assert.match(appSource, /restaurantApp: '\/app\/centro-de-control'/);
  assert.match(appSource, /app\.get\('\/app\/restaurante',[\s\S]*?res\.redirect\(302, '\/app\/centro-de-control'\)/);
  assert.ok(!appSource.includes("href: '/app/restaurante', icon: '🍽', label: 'Restaurante'"));

  assert.match(shellJs, /data-cc-home/);
  assert.match(shellJs, /openOperationalTab/);
  assert.match(shellJs, /data-tab/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/ui-context/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/mesas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/menu/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/comandas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/pedidos/);
  assert.ok(!shellJs.includes("location.href='/app/restaurante'"), 'Operational shell must not redirect normal actions to legacy UI');
  assert.match(restaurantHtml, /\.cc-classic-link\{display:none!important\}/);
  assert.match(shellCss, /\.rail-wrap/);
  assert.match(shellCss, /\.cc-dashboard/);

  // The operational shell continues to reuse the already validated write engine.
  assert.match(operationalEngine, /method:'POST'/);
  assert.match(operationalEngine, /method:'PUT'/);
  assert.match(operationalEngine, /method:'PATCH'/);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const control = await fetch(base + '/app/centro-de-control');
    const body = await control.text();
    assert.equal(control.status, 200);
    assert.equal(control.headers.get('x-vantixgc-restaurant-control'), 'operational-shell-v1');
    assert.equal(control.headers.get('x-vantixgc-restaurant-control-engine'), 'restaurant-ui-v1');
    assert.match(body, /restaurant-theme\.js/);
    assert.match(body, /restaurant-ui\.js/);
    assert.match(body, /restaurant-control-center\.css/);
    assert.match(body, /restaurant-control-center\.js/);

    const legacy = await fetch(base + '/app/restaurante', { redirect:'manual' });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/app/centro-de-control');
    assert.equal(legacy.headers.get('x-vantixgc-restaurant-canonical'), '/app/centro-de-control');

    for (const route of ['/app/dashboard', '/app/inventario']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.match(html, /href="\/app\/centro-de-control"[^>]*data-restaurant-entry="true"/);
      assert.ok(!/href="\/app\/restaurante"[^>]*data-restaurant-entry="true"/.test(html), `${route}: sidebar must not point to legacy Restaurant`);
    }

    const root = await fetch(base + '/');
    const rootBody = await root.json();
    assert.equal(rootBody.restaurantApp, '/app/centro-de-control');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT OPERATIONAL CONTROL CENTER + ROUTE UNIFICATION SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
