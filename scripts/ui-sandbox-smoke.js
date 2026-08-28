const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const html = fs.readFileSync('src/web/ui-sandbox.html', 'utf8');
  const routes = `${fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8')}\n${fs.readFileSync('src/modules/restaurant/restaurant.public.routes.base.js', 'utf8')}`;

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
  assert.match(routes, /X-VantixGC-UI-Sandbox', 'mock-local-v5-solid-pos'/);
  assert.match(routes, /X-VantixGC-UI-Sandbox-Runtime', 'self-contained'/);
  assert.match(routes, /X-VantixGC-UI-Theme', 'restaurant-solid-pos-v1'/);
  assert.match(routes, /X-VantixGC-UI-Style', 'solid-robust-v1'/);
  assert.match(routes, /X-VantixGC-UI-Preview-View/);
  assert.match(routes, /background:#0f172a!important/);
  assert.match(routes, /border:2px solid var\(--line\)!important/);
  assert.match(routes, /background:#ea580c!important/);
  assert.match(routes, /box-shadow:0 14px 30px rgba\(234,88,12,.34\)!important/);
  assert.match(routes, /\.qty button\{width:44px!important;height:44px!important;background:#0f172a!important;color:#fff!important/);
  assert.match(routes, /background:#dc2626!important;color:#fff!important/);
  assert.match(routes, /\.product:before\{/);
  assert.match(routes, /content:'FUERTES';background:#ea580c/);
  assert.match(routes, /content:'BEBIDAS';background:#2563eb/);
  assert.match(routes, /content:'POSTRES';background:#7c3aed/);
  assert.match(routes, /\.product strong\{display:inline-flex!important/);
  assert.match(routes, /background:#0f172a!important;color:#fff!important/);
  assert.match(routes, /replace\('Confirmar visualmente', 'Confirmar \/ Cobrar'\)/);
  assert.match(routes, /@keyframes posStatusPulse/);
  assert.match(routes, /tbody tr:hover td\{background:#ffedd5!important/);
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
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox'), 'mock-local-v5-solid-pos');
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox-runtime'), 'self-contained');
      assert.equal(response.headers.get('x-vantixgc-ui-theme'), 'restaurant-solid-pos-v1');
      assert.equal(response.headers.get('x-vantixgc-ui-style'), 'solid-robust-v1');
      assert.equal(response.headers.get('x-vantixgc-ui-preview-view'), expectedView);
      assert.match(body, /UI Sandbox/);
      assert.match(body, /content:'FUERTES'/);
      assert.match(body, /content:'BEBIDAS'/);
      assert.match(body, /background:#dc2626!important/);
      assert.ok(!body.includes('https://esm.sh'));
      if (expectedView === 'ventas') {
        assert.match(body, /const defaults=\{view:'ventas'/);
        assert.match(body, /Confirmar \/ Cobrar/);
      } else assert.match(body, /const defaults=\{view:'dashboard'/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('UI SANDBOX SOLID ROBUST POS STYLE SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});