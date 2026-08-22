const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

async function main() {
  const html = fs.readFileSync('src/web/ui-sandbox.html', 'utf8');
  const routes = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');

  assert.match(html, /VantixGC Super Core · UI Sandbox/);
  assert.match(html, /import React,\{useEffect,useState\}/);
  assert.match(html, /Restaurante \/ Mesas/);
  assert.match(html, /Ventas \/ POS/);
  assert.match(html, /Parametrización Contable/);
  assert.match(html, /Configuración avanzada/);
  assert.match(html, /setTables/);
  assert.match(html, /setCart/);
  assert.match(html, /setEntries/);
  assert.match(html, /setAccounts/);
  assert.match(html, /setTheme/);
  assert.match(html, /theme\.mode==='dark'/);
  assert.match(html, /Colapsar sidebar/);
  assert.match(html, /Datos completamente locales/);
  assert.ok(!html.includes("fetch('/api/"), 'Sandbox must not call production tenant APIs');
  assert.ok(!html.includes('Authorization:'), 'Sandbox must not use production auth tokens');
  assert.match(routes, /\['\/app\/v2-preview', '\/app\/sandbox'\]/);
  assert.match(routes, /X-VantixGC-UI-Sandbox/);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/app/v2-preview', '/app/sandbox']) {
      const response = await fetch(base + path);
      const body = await response.text();
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-vantixgc-ui-sandbox'), 'mock-local-v1');
      assert.match(body, /UI Sandbox/);
      assert.match(body, /useState/);
      assert.match(body, /Personalizar interfaz/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('UI SANDBOX MOCK-ONLY + INTERACTIVE STATE SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
