const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

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
      assert.match(html, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v2/);
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
    assert.match(salesHtml, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v2/);

    // Canonical Accounting must be the complete shared Core surface, never the
    // legacy lightweight PUC renderer embedded in the generic panel SPA.
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
    assert.match(accountingHtml, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v2/);

    // Advanced Configuration is also one canonical tenant surface. Four base
    // blocks are in the HTML and Notifications is installed as the fifth block.
    const advanced = await fetch(base + '/app/configuracion-avanzada');
    const advancedHtml = await advanced.text();
    assert.equal(advanced.status, 200);
    for (const marker of ['DIAN', 'Roles y permisos', 'Impresión', 'Nómina electrónica']) {
      assert.ok(advancedHtml.includes(marker), `Configuración avanzada debe contener ${marker}`);
    }
    assert.match(advancedHtml, /\/app\/notifications-config\.js/);
    assert.match(advancedHtml, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v2/);
    const notificationsUi = fs.readFileSync('src/web/notifications-config.js', 'utf8');
    assert.match(notificationsUi, /button\.textContent = 'Notificaciones'/);
    assert.match(notificationsUi, /data-notifications-tab/);

    // One shared runtime source normalizes every tenant Core sidebar. It keeps
    // the complete Accounting route, the permission-backed Restaurant entry,
    // Parametrización Contable and Advanced Configuration in the requested order.
    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    assert.match(sharedEntry, /const CORE_NAV_ITEMS = Object\.freeze/);
    assert.match(sharedEntry, /installCoreNavigationParity/);
    assert.match(sharedEntry, /href: '\/app\/restaurante'.*label: 'Restaurante'.*restaurantOnly: true/);
    assert.match(sharedEntry, /href: '\/app\/contabilidad'.*label: 'Contabilidad'/);
    assert.match(sharedEntry, /href: '\/app\/configuracion'.*label: 'Parametrización Contable'/);
    assert.match(sharedEntry, /href: '\/app\/configuracion-avanzada'.*label: 'Configuración avanzada'/);
    assert.match(sharedEntry, /heading\.textContent = 'Parametrización Contable'/);

    const script = canonicalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El panel debe contener su controlador SPA');
    new Function(script);

    const salesScript = salesHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(salesScript, 'Ventas debe contener su controlador operativo');
    new Function(salesScript);

    console.log('SUPER CORE PANEL UI + CANONICAL NAVIGATION V2 SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});