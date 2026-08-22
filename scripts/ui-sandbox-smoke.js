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

  assert.match(routes, /\['\/app\/v2-preview', '\/app\/sandbox'\]/);
  assert.match(routes, /X-VantixGC-UI-Sandbox', 'mock-local-v3-warm'/);
  assert.match(routes, /X-VantixGC-UI-Sandbox-Runtime', 'self-contained'/);
  assert.match(routes, /X-VantixGC-UI-Theme', 'restaurant-warm-v1'/);
  assert.match(routes, /vantixgc-sandbox-warm-theme-v1/);
  assert.match(routes, /#EA580C/);
  assert.match(routes, /--text:#111827/);
  assert.match(routes, /--line:#d6d3d1/);
  assert.match(routes, /\.qty button\{width:38px!important;height:38px!important/);

  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Sandbox must include an embedded runtime script');
  new Function(script);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/app/v2-preview', '/app/sandbox']) {
      const response = await fetch(base + path);
      const body = await response.text();
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox'), 'mock-local-v3-warm');
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox-runtime'), 'self-contained');
      assert.equal(response.headers.get('x-vantixgc-ui-theme'), 'restaurant-warm-v1');
      assert.match(body, /UI Sandbox/);
      assert.match(body, /function useState\(/);
      assert.match(body, /Personalizar interfaz/);
      assert.match(body, /vantixgc-sandbox-warm-theme-v1/);
      assert.match(body, /#EA580C/);
      assert.ok(!body.includes('https://esm.sh'));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('UI SANDBOX WARM RESTAURANT THEME + SELF-CONTAINED MOCK-ONLY SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
