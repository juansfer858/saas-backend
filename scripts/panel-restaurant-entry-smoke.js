const assert = require('node:assert/strict');
const fs = require('node:fs');

const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const originMarker = "\n(() => {\n  'use strict';\n  const ORIGIN_KEY = 'vantixgc_core_origin_v1';";
const sidebarRuntime = navigation.split(originMarker)[0];
const app = fs.readFileSync('src/app.js', 'utf8');

assert.ok(app.includes("const TENANT_NAV_VERSION = 'core-nav-v7'"));
assert.ok(app.includes("const TENANT_SIDEBAR_VERSION = 'core-sidebar-server-v1'"));
assert.ok(app.includes("const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver-server'"));
assert.ok(app.includes("const SIDEBAR_STABILITY_VERSION = 'tenant-card-server-slot-v1'"));
assert.ok(app.includes('const tenantNavigationItems = Object.freeze(['));
assert.ok(app.includes('canonicalTenantNavHtml'));
assert.ok(app.includes('canonicalTenantSidebarHtml'));
assert.ok(app.includes('replaceLegacyTenantSidebar'));
assert.ok(app.includes('data-core-navigation-structural="true"'));
assert.ok(app.includes('data-core-sidebar-version="${TENANT_SIDEBAR_VERSION}"'));

const expected = [
  ["href: '/app/centro-de-control'", "label: 'Restaurante'"],
  ["href: '/app/dashboard'", "label: 'Dashboard'"],
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

assert.ok(!app.includes("href: '/app/restaurante'"), 'Legacy Restaurant route must not be a sidebar entry');
assert.ok(app.includes("res.redirect(302, '/app/centro-de-control')"));
assert.ok(app.includes("restaurantApp: '/app/centro-de-control'"));

assert.ok(app.includes('linear-gradient(145deg,#a8b0b5 0%,#7f888f 28%,#5f676d 62%,#90989e 100%)'));
assert.ok(app.includes('background:rgba(243,246,248,.34)'));
assert.ok(app.includes('background:#137a53'));
assert.ok(app.includes('stroke-width:1.7'));
assert.ok(app.includes("subtitle: 'Operación principal'"));
assert.ok(app.includes("primaryVertical: true"));
assert.ok(app.includes('data-core-vertical-primary="true"'));
assert.ok(app.includes('<div class="nav-title">Principal</div>'));
assert.ok(app.includes('Finanzas y sistema'));
assert.ok(app.includes("res.set('X-VantixGC-Super-Core-Theme', SUPER_CORE_VISUAL_THEME)"));

// Tenant card is structural from the first frame and only its text is hydrated from
// the cached session. The sidebar runtime itself cannot insert or reshape navigation.
assert.ok(app.includes('data-core-tenant-card="true"'));
assert.ok(app.includes('data-core-tenant-name="true"'));
assert.ok(app.includes('data-core-tenant-meta="true"'));
assert.ok(app.includes('height:51px;min-height:51px'));
assert.ok(app.includes("res.set('X-VantixGC-Sidebar-Stability', SIDEBAR_STABILITY_VERSION)"));
assert.ok(sidebarRuntime.includes('function hydrateTenantCard()'));
assert.ok(sidebarRuntime.includes("document.querySelector('[data-core-tenant-name]')"));
assert.ok(sidebarRuntime.includes("document.querySelector('[data-core-tenant-meta]')"));
assert.ok(sidebarRuntime.includes('session.tenant?.nombreEmpresa || session.subdomain'));

assert.ok(sidebarRuntime.includes("const SUPER_CORE_VISUAL_THEME = 'super-core-v5-silver-server'"));
assert.ok(sidebarRuntime.includes("window.VantixGCCoreSidebarRuntime = 'off'"));
assert.ok(sidebarRuntime.includes("window.VantixGCCoreSidebarShellSource = 'server'"));
assert.ok(sidebarRuntime.includes("window.VantixGCCoreSidebarVisualTheme = SUPER_CORE_VISUAL_THEME"));
assert.ok(sidebarRuntime.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(sidebarRuntime.includes('bootstrapRestaurantAccessCache'));
assert.ok(sidebarRuntime.includes('writeCachedRestaurantAccess'));
assert.ok(sidebarRuntime.includes('installRestaurantDashboardEntry'));
assert.ok(!sidebarRuntime.includes('installTenantCard'));
assert.ok(!sidebarRuntime.includes("document.createElement('div')"));
assert.ok(!sidebarRuntime.includes("insertAdjacentElement('afterend'"));
assert.ok(!sidebarRuntime.includes('installSuperCoreV5Styles'));
assert.ok(!sidebarRuntime.includes('installSuperCoreV5Navigation'));
assert.ok(!sidebarRuntime.includes('iconPaths'));
assert.ok(!sidebarRuntime.includes('lineIcon('));
assert.ok(!sidebarRuntime.includes('nav.prepend'));
assert.ok(!sidebarRuntime.includes('innerHTML = svg'));
assert.ok(!sidebarRuntime.includes('document.createElement(\'style\')'));
assert.ok(!sidebarRuntime.includes('MutationObserver'));
assert.ok(!sidebarRuntime.includes('CLASSIC_RESTAURANT_PATH'));
assert.ok(!sidebarRuntime.includes('openRestaurantClassic'));
assert.ok(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(sidebarRuntime));

// Origin navigation is isolated from sidebar construction and may only operate
// on content plus sessionStorage.
assert.ok(navigation.includes("const ORIGIN_KEY = 'vantixgc_core_origin_v1'"));
assert.ok(navigation.includes('data-core-origin-return'));
assert.ok(navigation.includes('window.location.assign(destination)'));

for (const route of ['/app/ventas', '/app/compras', '/app/configuracion-avanzada', '/app/contabilidad']) {
  assert.ok(app.includes(`app.get('${route}'`), `Falta ruta ${route}`);
}

console.log('SUPER CORE V5 SERVER SIDEBAR + STABLE TENANT CARD SLOT + ORIGIN BACK SMOKE OK');