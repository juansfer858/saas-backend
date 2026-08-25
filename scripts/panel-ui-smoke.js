const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('../src/app');

const expectedNavHrefs = [
  '/app/centro-de-control',
  '/app/dashboard',
  '/app/ventas',
  '/app/compras',
  '/app/inventario',
  '/app/tesoreria',
  '/app/cartera',
  '/app/terceros',
  '/app/contabilidad',
  '/app/configuracion',
  '/app/configuracion-avanzada'
];

function extractSidebar(html) {
  return html.match(/<aside class="sidebar core-tenant-sidebar"[^>]*>([\s\S]*?)<\/aside>/)?.[0] || '';
}

function stableSidebarSignature(html) {
  return extractSidebar(html)
    .replace(/\sactive(?=[" ])/g, '')
    .replace(/class="active\s*/g, 'class="')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertCanonicalSidebar(html, route) {
  assert.match(html, /\/app\/panel-restaurant-entry\.js\?v=core-nav-v7/, route);
  assert.match(html, /data-core-navigation-version="core-nav-v7"/, route);
  assert.match(html, /data-core-navigation-structural="true"/, route);
  assert.match(html, /data-core-sidebar-version="core-sidebar-server-v1"/, route);
  assert.match(html, /data-core-visual-theme="super-core-v5-silver-server"/, route);
  assert.match(html, /data-core-sidebar-stability="tenant-card-server-slot-v1"/, route);
  assert.match(html, /class="sidebar core-tenant-sidebar"/, route);
  assert.match(html, /class="core-brandmark">V<\/div>/, route);
  assert.match(html, /data-core-tenant-card="true"/, route);
  assert.match(html, /data-core-tenant-name="true"/, route);
  assert.match(html, /data-core-tenant-meta="true"/, route);
  assert.match(html, /class="nav-title">Principal<\/div>/, route);
  assert.match(html, /class="core-v5-group-label">Finanzas y sistema<\/div>/, route);
  assert.match(html, /data-core-vertical-primary="true"/, route);
  assert.match(html, /<strong>Restaurante<\/strong><small>Operación principal<\/small>/, route);
  assert.match(html, /<svg viewBox="0 0 24 24" aria-hidden="true">/, route);

  const sidebarMatch = html.match(/<aside class="sidebar core-tenant-sidebar"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(sidebarMatch, `${route}: falta sidebar canónico completo`);
  const sidebar = sidebarMatch[1];
  const tenantAt = sidebar.indexOf('data-core-tenant-card="true"');
  const principalAt = sidebar.indexOf('class="nav-title">Principal</div>');
  assert.ok(tenantAt >= 0 && principalAt > tenantAt, `${route}: tarjeta tenant debe existir antes de Principal desde el HTML inicial`);
  const navMatch = sidebar.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, `${route}: falta navegación estructural`);
  const nav = navMatch[1];

  let cursor = -1;
  for (const href of expectedNavHrefs) {
    const at = nav.indexOf(`href="${href}"`, cursor + 1);
    assert.ok(at > cursor, `${route}: ruta fuera de orden o ausente: ${href}`);
    cursor = at;
  }

  assert.ok(nav.includes('data-restaurant-entry="true"'), `${route}: Restaurante debe conservar control por permiso`);
  assert.ok(!nav.includes('Contabilidad PUC'), `${route}: no debe renderizar Contabilidad PUC`);
  assert.ok(!nav.includes('<span>Configuración</span>'), `${route}: no debe renderizar Configuración genérica`);

  const styleAt = html.indexOf('core-nav-structural-style');
  const bodyAt = html.indexOf('<body');
  assert.ok(styleAt >= 0, `${route}: falta estilo estructural`);
  assert.ok(bodyAt < 0 || styleAt < bodyAt, `${route}: V5 debe existir antes del body para evitar flicker`);
  assert.ok(html.includes('linear-gradient(145deg,#a8b0b5 0%,#7f888f 28%,#5f676d 62%,#90989e 100%)'), `${route}: falta fondo V5 inicial`);
  assert.ok(html.includes('background:rgba(243,246,248,.34)'), `${route}: faltan botones claros V5 iniciales`);
  assert.ok(html.includes('height:51px;min-height:51px'), `${route}: la tarjeta tenant debe reservar altura fija`);
  assert.ok(!html.includes('.core-tenant-sidebar{background:#10241b'), `${route}: no debe existir el tema verde viejo en la capa canónica`);
  assert.ok(html.includes('font-family:"Segoe UI",Arial,sans-serif!important'), `${route}: sidebar debe usar tipografía nativa plana`);
  assert.ok(html.includes('text-shadow:none!important'), `${route}: texto del sidebar no debe tener sombra/difuminado`);
  assert.ok(html.includes('font-synthesis:none!important'), `${route}: no debe sintetizar pesos que engorden la tipografía`);
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let canonicalHtml = '';
    let stableSignature = '';
    for (const route of ['/app/dashboard', '/app/ventas/nueva', '/app/ventas/00000000-0000-0000-0000-000000000000']) {
      const response = await fetch(base + route);
      const html = await response.text();
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-vantixgc-tenant-nav'), 'core-nav-v7', route);
      assert.equal(response.headers.get('x-vantixgc-tenant-sidebar'), 'core-sidebar-server-v1', route);
      assert.equal(response.headers.get('x-vantixgc-super-core-theme'), 'super-core-v5-silver-server', route);
      assert.equal(response.headers.get('x-vantixgc-sidebar-stability'), 'tenant-card-server-slot-v1', route);
      assert.match(html, /VantixGC Super Core/);
      assert.match(html, /Nueva venta/);
      assert.match(html, /Registrar abono/);
      assertCanonicalSidebar(html, route);
      const signature = stableSidebarSignature(html);
      assert.ok(signature, `${route}: firma sidebar vacía`);
      if (!stableSignature) stableSignature = signature;
      else assert.equal(signature, stableSignature, `${route}: la estructura/altura del sidebar cambió entre rutas`);
      canonicalHtml = html;
    }

    assert.match(canonicalHtml, /\/app\/super-core-workspace-v6\.css\?v=core-workspace-v6-static/);
    assert.ok(canonicalHtml.includes('state.session.tenant?.nombreEmpresa||state.session.subdomain'), 'SPA sidebar debe derivar tenant directamente de la sesión en cada render');
    assert.ok(!canonicalHtml.includes('data-core-tenant-name=\"true\">VantixGC</b><span data-core-tenant-meta=\"true\">Tenant activo'), 'SPA no puede volver al placeholder global');
    const workspaceLinkAt = canonicalHtml.indexOf('/app/super-core-workspace-v6.css?v=core-workspace-v6-static');
    const firstBodyAt = canonicalHtml.indexOf('<body');
    assert.ok(workspaceLinkAt >= 0 && (firstBodyAt < 0 || workspaceLinkAt < firstBodyAt), 'V6 debe cargarse en head antes del primer paint');
    assert.ok(canonicalHtml.includes('background:rgba(250,252,253,.72)!important'), 'botones claros deben venir en CSS inicial del servidor');
    assert.ok(canonicalHtml.includes('color:#17212b!important'), 'texto oscuro debe venir en CSS inicial del servidor');
    const workspaceCssResponse = await fetch(base + '/app/super-core-workspace-v6.css');
    const workspaceCss = await workspaceCssResponse.text();
    assert.equal(workspaceCssResponse.status, 200);
    assert.match(workspaceCss, /--core-v6-orange:#f97316/);
    assert.match(workspaceCss, /body\{background:var\(--core-v6-bg\)!important/);

    const salesResponse = await fetch(base + '/app/ventas');
    const salesHtml = await salesResponse.text();
    assert.equal(salesResponse.status, 200);
    assert.equal(salesResponse.headers.get('x-vantixgc-super-core-theme'), 'super-core-v5-silver-server');
    assert.equal(salesResponse.headers.get('x-vantixgc-sidebar-stability'), 'tenant-card-server-slot-v1');
    assert.match(salesHtml, /\+ Nueva venta/);
    assert.match(salesHtml, /Guardar borrador/);
    assert.match(salesHtml, /Emitir venta/);
    assert.match(salesHtml, /Documento Equivalente POS/);
    assert.match(salesHtml, /Kardex\/recetas/);
    assert.match(salesHtml, /cola DIAN/);
    assertCanonicalSidebar(salesHtml, '/app/ventas');
    assert.match(salesHtml, /data-core-tenant-first-paint=\"true\"/);
    assert.ok(!salesHtml.includes('data-core-tenant-name=\"true\">VantixGC</b><span data-core-tenant-meta=\"true\">Tenant activo'), 'rutas completas no deben mostrar identidad global como tenant');
    assert.equal(stableSidebarSignature(salesHtml), stableSignature, '/app/ventas: sidebar debe conservar la misma geometría');

    const accounting = await fetch(base + '/app/contabilidad');
    const accountingHtml = await accounting.text();
    assert.equal(accounting.status, 200);
    assert.equal(accounting.headers.get('x-vantixgc-super-core-theme'), 'super-core-v5-silver-server');
    assert.equal(accounting.headers.get('x-vantixgc-sidebar-stability'), 'tenant-card-server-slot-v1');
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
    assert.equal(stableSidebarSignature(accountingHtml), stableSignature, '/app/contabilidad: sidebar debe conservar la misma geometría');

    const advanced = await fetch(base + '/app/configuracion-avanzada');
    const advancedHtml = await advanced.text();
    assert.equal(advanced.status, 200);
    assert.equal(advanced.headers.get('x-vantixgc-super-core-theme'), 'super-core-v5-silver-server');
    assert.equal(advanced.headers.get('x-vantixgc-sidebar-stability'), 'tenant-card-server-slot-v1');
    for (const marker of ['DIAN', 'Roles y permisos', 'Impresión', 'Nómina electrónica']) {
      assert.ok(advancedHtml.includes(marker), `Configuración avanzada debe contener ${marker}`);
    }
    assert.match(advancedHtml, /\/app\/notifications-config\.js/);
    assertCanonicalSidebar(advancedHtml, '/app/configuracion-avanzada');
    assert.equal(stableSidebarSignature(advancedHtml), stableSignature, '/app/configuracion-avanzada: sidebar debe conservar la misma geometría');

    const sharedEntry = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
    assert.match(sharedEntry, /const NAV_VERSION = 'core-nav-v7'/);
    assert.match(sharedEntry, /window\.VantixGCCoreSidebarRuntime = 'off'/);
    assert.match(sharedEntry, /window\.VantixGCCoreSidebarShellSource = 'server'/);
    assert.match(sharedEntry, /bootstrapRestaurantAccessCache/);
    assert.match(sharedEntry, /function hydrateTenantCard\(\)/);
    assert.match(sharedEntry, /data-core-tenant-name/);
    assert.match(sharedEntry, /data-core-tenant-meta/);
    assert.match(sharedEntry, /const SIDEBAR_TEXT_COLOR = '#17212b'/);
    assert.ok(!sharedEntry.includes('applyFlatDarkSidebarText'));
    assert.ok(!sharedEntry.includes("style.setProperty('color'"));
    assert.ok(!sharedEntry.includes('installTenantCard'));
    assert.ok(!sharedEntry.includes("document.createElement('div')"));
    assert.ok(!sharedEntry.includes('installSuperCoreV5Styles'));
    assert.ok(!sharedEntry.includes('installSuperCoreV5Navigation'));
    assert.ok(!sharedEntry.includes('document.createElement(\'style\')'));
    assert.ok(!sharedEntry.includes('nav.prepend'));
    assert.ok(!sharedEntry.includes('MutationObserver'));
    assert.ok(!sharedEntry.includes('installWorkspaceTheme'));
    assert.ok(!sharedEntry.includes('insertAdjacentHTML'));
    assert.ok(!sharedEntry.includes('super-core-workspace-v6-style'));

    const script = canonicalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'El panel debe contener su controlador SPA');
    new Function(script);

    const salesScript = salesHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(salesScript, 'Ventas debe contener su controlador operativo');
    new Function(salesScript);

    console.log('SUPER CORE V5 STABLE SIDEBAR GEOMETRY + PERSISTENT DARK TEXT SMOKE OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});