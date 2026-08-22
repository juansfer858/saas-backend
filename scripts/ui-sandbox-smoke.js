const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const html = fs.readFileSync('src/web/ui-sandbox.html', 'utf8');
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');

  assert.match(html, /VantixGC Super Core · UI Sandbox/);
  assert.match(html, /function useState\(/);
  assert.match(html, /window\.VantixGCUISandbox=\{version:'mock-local-v2',runtime:'self-contained',useState\}/);
  assert.match(html, /Restaurante \/ Mesas/);
  assert.match(html, /Ventas \/ POS/);
  assert.match(html, /Parametrización Contable/);
  assert.match(html, /Configuración avanzada/);
  assert.match(html, /data-table-state="Libre"/);
  assert.match(html, /data-add-product/);
  assert.match(html, /entryForm/);
  assert.match(html, /accountForm/);
  assert.match(html, /Personalizar interfaz/);
  assert.match(html, /Colapsar sidebar/);
  assert.match(html, /Datos completamente locales/);
  assert.ok(!html.includes('esm.sh'), 'Sandbox must not depend on esm.sh');
  assert.ok(!html.includes('unpkg.com'), 'Sandbox must not depend on unpkg');
  assert.ok(!html.includes('jsdelivr.net'), 'Sandbox must not depend on jsdelivr');
  assert.ok(!html.includes('type="module"'), 'Sandbox must not require module imports');
  assert.ok(!html.includes("fetch('/api/"), 'Sandbox must not call production tenant APIs');
  assert.ok(!html.includes('Authorization:'), 'Sandbox must not use production auth tokens');

  assert.match(routes, /\/app\/v2-preview\/dashboard/);
  assert.match(routes, /\/app\/v2-preview\/ventas/);
  assert.match(routes, /X-VantixGC-UI-Sandbox', 'mock-local-v4-pos-impact'/);
  assert.match(routes, /X-VantixGC-UI-Sandbox-Runtime', 'self-contained'/);
  assert.match(routes, /X-VantixGC-UI-Theme', 'restaurant-pos-impact-v1'/);
  assert.match(routes, /X-VantixGC-UI-Preview-View/);
  assert.match(routes, /vantixgc-sandbox-pos-impact-v1/);
  assert.match(routes, /background:#0f172a!important/);
  assert.match(routes, /color:#fb923c!important/);
  assert.match(routes, /background:#f97316!important/);
  assert.match(routes, /border-radius:18px!important/);
  assert.match(routes, /metric-value\{font-size:27px!important/);
  assert.match(routes, /nth-child\(1\) \.metric-icon/);
  assert.match(routes, /nth-child\(4\) \.metric-icon/);
  assert.match(routes, /@keyframes posStatusPulse/);
  assert.match(routes, /tbody tr:hover td\{background:#fff7ed!important/);
  assert.match(routes, /initialView = req\.path\.endsWith\('\/ventas'\) \? 'ventas' : 'dashboard'/);

  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Sandbox must include an embedded runtime script');
  new Function(script);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [
      ['/app/v2-preview', 'dashboard'],
      ['/app/v2-preview/dashboard', 'dashboard'],
      ['/app/v2-preview/ventas', 'ventas'],
      ['/app/sandbox', 'dashboard']
    ];
    for (const [path, expectedView] of cases) {
      const response = await fetch(base + path);
      const body = await response.text();
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox'), 'mock-local-v4-pos-impact');
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox-runtime'), 'self-contained');
      assert.equal(response.headers.get('x-vantixgc-ui-theme'), 'restaurant-pos-impact-v1');
      assert.equal(response.headers.get('x-vantixgc-ui-preview-view'), expectedView);
      assert.match(body, /UI Sandbox/);
      assert.match(body, /vantixgc-sandbox-pos-impact-v1/);
      assert.match(body, /#0f172a/);
      assert.match(body, /#f97316/);
      assert.ok(!body.includes('https://esm.sh'));
      if (expectedView === 'ventas') assert.match(body, /const defaults=\{view:'ventas'/);
      else assert.match(body, /const defaults=\{view:'dashboard'/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('UI SANDBOX POS IMPACT DASHBOARD + SALES PREVIEW SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
