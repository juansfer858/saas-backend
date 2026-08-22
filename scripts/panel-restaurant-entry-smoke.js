const assert = require('node:assert/strict');
const fs = require('node:fs');

const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');

assert.ok(app.includes("const TENANT_NAV_VERSION = 'core-nav-v7'"));
assert.ok(app.includes("const TENANT_SIDEBAR_VERSION = 'core-sidebar-server-v1'"));
assert.ok(app.includes('const tenantNavigationItems = Object.freeze(['));
assert.ok(app.includes('canonicalTenantNavHtml'));
assert.ok(app.includes('canonicalTenantSidebarHtml'));
assert.ok(app.includes('replaceLegacyTenantSidebar'));
assert.ok(app.includes('data-core-navigation-structural="true"'));
assert.ok(app.includes('data-core-sidebar-version="${TENANT_SIDEBAR_VERSION}"'));

const expected = [
  ["href: '/app/dashboard'", "label: 'Dashboard'"],
  ["href: '/app/centro-de-control'", "label: 'Restaurante'"],
  ["href: '/app/ventas'", "label: 'Ventas'"],
  ["href: '/app/compras'", "label: 'Compras'"],
  ["href: '/app/inventario'", "label: 'Inventarios / Kardex'"],
  ["href: '/app/tesoreria'", "label: 'Tesorería & Bancos'"],
  ["href: '/app/cartera'", "label: 'Cartera'"],
  ["href: '/app/terceros'", "label: 'Terceros'"],
  ["href: '/app/contabilidad'", "label: 'Contabilidad'"],
  ["href: '/app/configuracion'", "label: 'Parametrización Contable'"],
  ["href: '/app/configuracion-avanzada'", "label: 'Configuración avanzada'"]
];

let cursor = -1;
for (const [href, label] of expected) {
  const hrefAt = app.indexOf(href, cursor + 1);
  const labelAt = app.indexOf(label, hrefAt);
  assert.ok(hrefAt > cursor, `Ruta fuera de orden o ausente: ${href}`);
  assert.ok(labelAt > hrefAt, `Etiqueta ausente: ${label}`);
  cursor = hrefAt;
}

assert.ok(!app.includes("href: '/app/restaurante', icon: '🍽', label: 'Restaurante'"), 'Legacy Restaurant route must not be a sidebar entry');
assert.ok(app.includes("res.redirect(302, '/app/centro-de-control')"), 'Legacy Restaurant URL must redirect to the canonical Control Center');
assert.ok(app.includes("restaurantApp: '/app/centro-de-control'"));

assert.ok(app.includes('<div class="core-brandmark">V</div>'));
assert.ok(app.includes('<div class="nav-title">Navegación</div>'));
assert.ok(app.includes('.core-tenant-sidebar .nav a'));
assert.ok(app.includes("res.set('X-VantixGC-Tenant-Sidebar', TENANT_SIDEBAR_VERSION)"));

// Browser runtime remains OFF for structural sidebar ownership. V5 only skins and
// promotes the existing permission-backed server navigation; it does not rebuild it.
assert.ok(navigation.includes("const NAV_VERSION = 'core-nav-v7'"));
assert.ok(navigation.includes("const CONTROL_CENTER_PATH = '/app/centro-de-control'"));
assert.ok(navigation.includes("window.VantixGCCoreSidebarRuntime = 'off'"));
assert.ok(navigation.includes("window.VantixGCCoreSidebarShellSource = 'server'"));
assert.ok(navigation.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(navigation.includes('sessionStorage'));
assert.ok(navigation.includes('bootstrapRestaurantAccessCache'));
assert.ok(navigation.includes('writeCachedRestaurantAccess'));
assert.ok(navigation.includes('installRestaurantDashboardEntry'));
assert.ok(!navigation.includes('CLASSIC_RESTAURANT_PATH'));
assert.ok(!navigation.includes('openRestaurantClassic'));
assert.ok(!navigation.includes('MutationObserver'));
assert.ok(!navigation.includes('normalizeSidebarChrome'));
assert.ok(!navigation.includes('ensureCanonicalSidebarStyles'));
assert.ok(!navigation.includes('updateActiveNavigation'));
assert.ok(!navigation.includes('nav.innerHTML'));
assert.ok(!navigation.includes('canonicalNavigationHtml'));
assert.ok(!navigation.includes('CORE_NAV_ITEMS'));
assert.ok(!navigation.includes("rol === 'ADMIN'"), 'Restaurant visibility must remain permission-backed');

// Approved administrative identity: V5 silver/dark background + lighter navigation
// buttons, green used as accent, and one consistent thin-line SVG icon system.
assert.ok(navigation.includes("const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver'"));
assert.ok(navigation.includes('linear-gradient(145deg,#a8b0b5 0%,#7f888f 28%,#5f676d 62%,#90989e 100%)'));
assert.ok(navigation.includes('background:rgba(243,246,248,.34)'));
assert.ok(navigation.includes('background:#137a53'));
assert.ok(navigation.includes('stroke-width:1.7'));
assert.ok(navigation.includes('const iconPaths = Object.freeze'));
assert.ok(navigation.includes("window.VantixGCCoreSidebarVisualTheme = SUPER_CORE_VISUAL_THEME"));

// The current vertical is the commercial protagonist. It is visually promoted ahead
// of Dashboard without changing permissions or its canonical route.
assert.ok(navigation.includes("primary.classList.add('core-v5-primary-vertical')"));
assert.ok(navigation.includes("primary.dataset.coreVerticalPrimary = 'true'"));
assert.ok(navigation.includes("small.textContent = 'Operación principal'"));
assert.ok(navigation.includes('nav.prepend(primary)'));
assert.ok(navigation.includes('.core-tenant-sidebar .nav a.core-v5-primary-vertical'));
assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(navigation), 'Visual/navigation layer must not perform business writes');

assert.ok(app.includes("res.set('Cache-Control', 'no-store')"));
assert.ok(app.includes('core-nav-structural-style'));
assert.ok(app.includes('/app/panel-restaurant-entry.js?v=${TENANT_NAV_VERSION}'));
assert.ok(app.includes("res.set('X-VantixGC-Tenant-Nav', TENANT_NAV_VERSION)"));

for (const route of ['/app/ventas', '/app/compras', '/app/configuracion-avanzada', '/app/contabilidad']) {
  assert.ok(app.includes(`app.get('${route}'`), `Falta ruta ${route}`);
}

assert.ok(app.includes('sendTenantHtml(salesHtmlPath, req, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(purchasesHtmlPath, req, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(platformCoreConfigHtmlPath, req, res, next, [notificationsTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(accountingHtmlPath, req, res, next, [guardTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(panelHtmlPath, req, res, next, [integrationTag, tenantNavigationTag])'));

console.log('PANEL SERVER SIDEBAR + APPROVED SUPER CORE V5 + PRIMARY VERTICAL SMOKE OK');