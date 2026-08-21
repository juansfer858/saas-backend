const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

function assertCanonicalNavBootstrap(html, route) {
  assert.match(html, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v5/, route);
  const antiFlashAt = html.indexOf('core-nav-anti-flash');
  const headEndAt = html.indexOf('</head>');
  const bodyAt = html.indexOf('<body');
  assert.ok(antiFlashAt >= 0, `${route}: falta anti-flash`);
  assert.ok(headEndAt >= 0 && antiFlashAt < headEndAt, `${route}: anti-flash debe estar dentro de <head>`);
  assert.ok(bodyAt < 0 || antiFlashAt < bodyAt, `${route}: anti-flash debe cargarse antes de <body>`);
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
      assert.match(html, /VantixGC Super Core/);
      assert.match(html, /Nueva venta/);
      assert.match(html, /Registrar abono/);
      assertCanonicalNavBootstrap(html, route);
      canonicalHtml = html;
    }

    const salesResponse = await fetch(base + '/app/ventas');
    const salesHtml = await salesResponse.text();
    assert.equal(salesResponse.status, 200);
    assert.match(salesHtml, /VantixGC Super Core/);
    assert.match(salesHtml, /\+ Nueva venta/);
    assert.match(salesHtml, /Guardar borrador/);
    assert.match(salesHtml, /Emitir venta/);
    assert.match(salesHtml, /Documento Equivalente POS/);
    assert.match(salesHtml, /Kardex\/recetas/);
    assert.match(salesHtml, /cola DIAN/);
    assertCanonicalNavBootstrap(salesHtml, '/app/ventas');

    const accounting = await fetch(base + '/app/contabilidad');
    const accountingHtml = await accounting.text();
    assert.equal(accounting.status, 200);
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
    assertCanonicalNavBootstrap(accountingHtml, '/app/contabilidad');

    const advanced = await fetch(base + '/app/configuracion-avanzada');
    const advancedHtml = await advanced.text();
    assert.equal(advanced.status, 200);
    for (const marker of ['DIAN', 'Roles y permisos', 'Impresión', 'Nómina electrónica']) {
      assert.ok(advancedHtml.includes(marker), `Configuración avanzada debe contener ${marker}`);
    }
    assert.match(advancedHtml, /\/app\/notifications-config\.js/);
    assertCanonicalNavBootstrap(advancedHtml, '/app/configuracion-avanzada');
    const notificationsUi = fs.readFileSync('src/web/notifications-config.js', 'utf8');
    assert.match(notificationsUi, /button\.textContent = 'Notificaciones'/);
    assert.match(notificationsUi, /data-notifications-tab/);

    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    assert.match(sharedEntry, /const NAV_VERSION = 'core-nav-v5'/);
    assert.match(sharedEntry, /const CORE_NAV_ITEMS = Object\.freeze/);
    assert.match(sharedEntry, /installCoreNavigationParity/);
    assert.match(sharedEntry, /href: '\/app\/restaurante'.*label: 'Restaurante'.*restaurantOnly: true/);
    assert.match(sharedEntry, /href: '\/app\/contabilidad'.*label: 'Contabilidad'/);
    assert.match(sharedEntry, /href: '\/app\/configuracion'.*label: 'Parametrización Contable'/);
    assert.match(sharedEntry, /href: '\/app\/configuracion-avanzada'.*label: 'Configuración avanzada'/);
    assert.match(sharedEntry, /heading\.textContent = 'Parametrización Contable'/);
    assert.match(sharedEntry, /sessionStorage/);
    assert.match(sharedEntry, /bootstrapRestaurantAccessCache/);

    const script = canonicalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El panel debe contener su controlador SPA');
    new Function(script);

    const salesScript = salesHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(salesScript, 'Ventas debe contener su controlador operativo');
    new Function(salesScript);

    console.log('SUPER CORE PANEL UI + CANONICAL NAVIGATION V5 HEAD ANTI-FLASH SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});