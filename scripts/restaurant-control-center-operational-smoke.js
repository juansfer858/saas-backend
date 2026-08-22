const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
  const panelEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
  const shellJs = fs.readFileSync('src/web/restaurant-control-center.js', 'utf8');
  const shellCss = fs.readFileSync('src/web/restaurant-control-center.css', 'utf8');
  const classicUi = fs.readFileSync('src/web/restaurant-ui.js', 'utf8');

  assert.match(routes, /\/app\/centro-de-control/);
  assert.match(routes, /operational-shell-v1/);
  assert.match(routes, /restaurant-ui-v1/);
  assert.match(routes, /X-VantixGC-Restaurant-Control-Fallback/);
  assert.match(routes, /restaurant-control-center\.css/);
  assert.match(routes, /restaurant-control-center\.js/);

  assert.match(panelEntry, /CONTROL_CENTER_PATH = '\/app\/centro-de-control'/);
  assert.match(panelEntry, /CLASSIC_RESTAURANT_PATH = '\/app\/restaurante'/);

  assert.match(shellJs, /data-cc-home/);
  assert.match(shellJs, /openOperationalTab/);
  assert.match(shellJs, /data-tab=\\"\$\{tab\}\\"/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/ui-context/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/mesas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/menu/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/comandas/);
  assert.match(shellJs, /\/api\/v1\/restaurante\/pedidos/);
  assert.ok(!shellJs.includes("location.href='/app/restaurante'"), 'Operational shell must not redirect normal actions to classic UI');
  assert.match(shellJs, /href = '\/app\/restaurante'/);
  assert.match(shellCss, /\.rail-wrap/);
  assert.match(shellCss, /\.cc-dashboard/);
  assert.match(classicUi, /method:'POST'/);
  assert.match(classicUi, /method:'PATCH'/);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/app/centro-de-control');
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-vantixgc-restaurant-control'), 'operational-shell-v1');
    assert.equal(response.headers.get('x-vantixgc-restaurant-control-engine'), 'restaurant-ui-v1');
    assert.equal(response.headers.get('x-vantixgc-restaurant-control-fallback'), '/app/restaurante');
    assert.match(body, /restaurant-theme\.js/);
    assert.match(body, /restaurant-ui\.js/);
    assert.match(body, /restaurant-control-center\.css/);
    assert.match(body, /restaurant-control-center\.js/);

    const css = await fetch(base + '/app/restaurant-control-center.css');
    const js = await fetch(base + '/app/restaurant-control-center.js');
    assert.equal(css.status, 200);
    assert.equal(js.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('RESTAURANT OPERATIONAL CONTROL CENTER SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
