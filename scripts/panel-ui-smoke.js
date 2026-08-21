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

function assertCanonicalSidebar(html, route) {
  assert.match(html, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v7/, route);
  assert.match(html, /data-core-navigation-version="core-nav-v7"/, route);
  assert.match(html, /data-core-navigation-structural="true"/, route);
  assert.match(html, /data-core-sidebar-version="core-sidebar-server-v1"/, route);
  assert.match(html, /class="sidebar core-tenant-sidebar"/, route);
  assert.match(html, /class="core-brandmark">V<\/div>/, route);
  assert.match(html, /class="nav-title">Navegación<\/div>/, route);

  const sidebarMatch = html.match(/<aside class="sidebar core-tenant-sidebar"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(sidebarMatch, `${route}: falta sidebar canónico completo`);
  const sidebar = sidebarMatch[1];
  const navMatch = sidebar.match(/<nav class="nav" data-core-navigation-version="core-nav-v7" data-core-navigation-structural="true">([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, `${route}: falta navegación estructural`);
  const nav = navMatch[1];

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
  assert.ok(styleAt < headEndAt, `${route}: estilo/sidebar debe estar listo en head`);
  assert.ok(bodyAt < 0 || styleAt < bodyAt, `${route}: estilo/sidebar debe preceder body`);
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
      assert.equal(response.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v7', route);
      assert.equal(response.headers.get('x-vantixgc-tenant-sidebar'), 'core-sidebar-server-v1', route);
      assert.match(html, /VantixGC Super Core/);
      assert.match(html, /Nueva venta/);
      assert.match(html, /Registrar abono/);
      assertCanonicalSidebar(html, route);
      canonicalHtml = html;
    }

    const salesResponse = await fetch(base + '/app/ventas');
    const salesHtml = await salesResponse.text();
    assert.equal(salesResponse.status, 200);
    assert.equal(salesResponse.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v7');
    assert.equal(salesResponse.headers.get('x-vantixgc-tenant-sidebar'), 'core-sidebar-server-v1');
    assert.match(salesHtml, /VantixGC Super Core/);
    assert.match(salesHtml, /\+ Nueva venta/);
    assert.match(salesHtml, /Guardar borrador/);
    assert.match(salesHtml, /Emitir venta/);
    assert.match(salesHtml, /Documento Equivalente POS/);
    assert.match(salesHtml, /Kardex\/recetas/);
    assert.match(salesHtml, /cola DIAN/);
    assertCanonicalSidebar(salesHtml, '/app/ventas');

    const accounting = await fetch(base + '/app/contabilidad');
    const accountingHtml = await accounting.text();
    assert.equal(accounting.status, 200);
    assert.equal(accounting.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v7');
    assert.equal(accounting.headers.get('x-vantixgc-tenant-sidebar'), 'core-sidebar-server-v1');
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
    assertCanonicalSidebar(accountingHtml, '/app/contabilidad');

    const advanced = await fetch(base + '/app/configuracion-avanzada');
    const advancedHtml = await advanced.text();
    assert.equal(advanced.status, 200);
    assert.equal(advanced.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v7');
    assert.equal(advanced.headers.get('x-vantixgc-tenant-sidebar'), 'core-sidebar-server-v1');
    for (const marker of ['DIAN', 'Roles y permisos', 'Impresión', 'Nómina electrónica']) {
      assert.ok(advancedHtml.includes(marker), `Configuración avanzada debe contener ${marker}`);
    }
    assert.match(advancedHtml, /\/app\/notifications-config\.js/);
    assertCanonicalSidebar(advancedHtml, '/app/configuracion-avanzada');

    const notificationsUi = fs.readFileSync('src/web/notifications-config.js', 'utf8');
    assert.match(notificationsUi, /button\.textContent = 'Notificaciones'/);
    assert.match(notificationsUi, /data-notifications-tab/);

    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    assert.match(sharedEntry, /const NAV_VERSION = 'core-nav-v7'/);
    assert.match(sharedEntry, /window\.VantixGCCoreSidebarRuntime = 'off'/);
    assert.match(sharedEntry, /window\.VantixGCCoreSidebarShellSource = 'server'/);
    assert.match(sharedEntry, /bootstrapRestaurantAccessCache/);
    assert.ok(!sharedEntry.includes('MutationObserver'));
    assert.ok(!sharedEntry.includes('normalizeSidebarChrome'));
    assert.ok(!sharedEntry.includes('ensureCanonicalSidebarStyles'));
    assert.ok(!sharedEntry.includes('updateActiveNavigation'));
    assert.ok(!sharedEntry.includes('nav.innerHTML'));

    const script = canonicalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El panel debe contener su controlador SPA');
    new Function(script);

    const salesScript = salesHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(salesScript, 'Ventas debe contener su controlador operativo');
    new Function(salesScript);

    console.log('SUPER CORE PANEL UI + SERVER SIDEBAR V1 + NAV V7 SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});