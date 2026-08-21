const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

const expectedNavLabels = [
  'Dashboard',
  'Restaurante',
  'Ventas',
  'Compras',
  'Inventarios / Kardex',
  'Tesorería & Bancos',
  'Cartera',
  'Terceros',
  'Contabilidad',
  'Parametrización Contable',
  'Configuración avanzada'
];

function assertStructuralNavigation(html, route) {
  assert.match(html, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v6/, route);
  assert.match(html, /data-core-navigation-version="core-nav-v6"/, route);
  assert.match(html, /data-core-navigation-structural="true"/, route);

  const match = html.match(/<nav class="nav" data-core-navigation-version="core-nav-v6" data-core-navigation-structural="true">([\s\S]*?)<\/nav>/);
  assert.ok(match, `${route}: falta navegación estructural`);
  const nav = match[1];

  let cursor = -1;
  for (const label of expectedNavLabels) {
    const at = nav.indexOf(`<span>${label}</span>`, cursor + 1);
    assert.ok(at > cursor, `${route}: etiqueta fuera de orden o ausente: ${label}`);
    cursor = at;
  }

  assert.ok(nav.includes('data-restaurant-entry="true"'), `${route}: Restaurante debe conservar control por permiso`);
  assert.ok(!nav.includes('Contabilidad PUC'), `${route}: no debe renderizar Contabilidad PUC`);
  assert.ok(!nav.includes('<span>Configuración</span>'), `${route}: no debe renderizar Configuración genérica`);

  const styleAt = html.indexOf('core-nav-structural-style');
  const headEndAt = html.indexOf('</head>');
  const bodyAt = html.indexOf('<body');
  assert.ok(styleAt >= 0, `${route}: falta estilo estructural`);
  assert.ok(styleAt < headEndAt, `${route}: el bootstrap de visibilidad debe estar en head`);
  assert.ok(bodyAt < 0 || styleAt < bodyAt, `${route}: el bootstrap debe preceder body`);
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let canonicalHtml = '';
    for (const route of ['/app/dashboard', '/app/ventas/nueva', '/app/ventas/00000000-0000-0000-0000-000000000000']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v6', route);
      assert.match(html, /VantixGC Super Core/);
      assert.match(html, /Nueva venta/);
      assert.match(html, /Registrar abono/);
      assertStructuralNavigation(html, route);
      canonicalHtml = html;
    }

    const salesResponse = await fetch(base + '/app/ventas');
    const salesHtml = await salesResponse.text();
    assert.equal(salesResponse.status, 200);
    assert.equal(salesResponse.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v6');
    assert.match(salesHtml, /VantixGC Super Core/);
    assert.match(salesHtml, /\+ Nueva venta/);
    assert.match(salesHtml, /Guardar borrador/);
    assert.match(salesHtml, /Emitir venta/);
    assert.match(salesHtml, /Documento Equivalente POS/);
    assert.match(salesHtml, /Kardex\/recetas/);
    assert.match(salesHtml, /cola DIAN/);
    assertStructuralNavigation(salesHtml, '/app/ventas');

    const accounting = await fetch(base + '/app/contabilidad');
    const accountingHtml = await accounting.text();
    assert.equal(accounting.status, 200);
    assert.equal(accounting.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v6');
    for (const marker of [
      'Plan de Cuentas',
      'Libro Diario',
      'Comprobante Manual',
      'Libro Mayor',
      'Reportes',
      'Balance de Prueba',
      'Estado de Resultados',
      'Balance General / Situación Financiera'
    ]) assert.match(accountingHtml, new RegExp(marker));
    assertStructuralNavigation(accountingHtml, '/app/contabilidad');

    const advanced = await fetch(base + '/app/configuracion-avanzada');
    const advancedHtml = await advanced.text();
    assert.equal(advanced.status, 200);
    assert.equal(advanced.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v6');
    for (const marker of ['DIAN', 'Roles y permisos', 'Impresión', 'Nómina electrónica']) {
      assert.ok(advancedHtml.includes(marker), `Configuración avanzada debe contener ${marker}`);
    }
    assert.match(advancedHtml, /\/app\/notifications-config\.js/);
    assertStructuralNavigation(advancedHtml, '/app/configuracion-avanzada');

    const notificationsUi = fs.readFileSync('src/web/notifications-config.js', 'utf8');
    assert.match(notificationsUi, /button\.textContent = 'Notificaciones'/);
    assert.match(notificationsUi, /data-notifications-tab/);

    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    assert.match(sharedEntry, /const NAV_VERSION = 'core-nav-v6'/);
    assert.match(sharedEntry, /updateActiveNavigation/);
    assert.match(sharedEntry, /bootstrapRestaurantAccessCache/);
    assert.ok(!sharedEntry.includes('nav.innerHTML'));
    assert.ok(!sharedEntry.includes('canonicalNavigationHtml'));

    const script = canonicalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El panel debe contener su controlador SPA');
    new Function(script);

    const salesScript = salesHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(salesScript, 'Ventas debe contener su controlador operativo');
    new Function(salesScript);

    console.log('SUPER CORE PANEL UI + STRUCTURAL NAVIGATION V6 SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});