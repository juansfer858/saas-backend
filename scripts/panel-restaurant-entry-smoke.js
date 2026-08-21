const assert = require('node:assert/strict');
const fs = require('node:fs');

const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');

assert.ok(app.includes("const TENANT_NAV_VERSION = 'core-nav-v6'"));
assert.ok(app.includes('const tenantNavigationItems = Object.freeze(['));
assert.ok(app.includes('canonicalTenantNavHtml'));
assert.ok(app.includes('replaceLegacyTenantNav'));
assert.ok(app.includes('data-core-navigation-structural="true"'));

const expected = [
  ["href: '/app/dashboard'", "label: 'Dashboard'"],
  ["href: '/app/restaurante'", "label: 'Restaurante'"],
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

// Runtime no longer rebuilds the sidebar. It only resolves Restaurant visibility,
// active state and the optional Dashboard shortcut.
assert.ok(navigation.includes("const NAV_VERSION = 'core-nav-v6'"));
assert.ok(navigation.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(navigation.includes('sessionStorage'));
assert.ok(navigation.includes('bootstrapRestaurantAccessCache'));
assert.ok(navigation.includes('writeCachedRestaurantAccess'));
assert.ok(navigation.includes('updateActiveNavigation'));
assert.ok(navigation.includes('installRestaurantDashboardEntry'));
assert.ok(!navigation.includes('canonicalNavigationHtml'));
assert.ok(!navigation.includes('nav.innerHTML'));
assert.ok(!navigation.includes('CORE_NAV_ITEMS'));
assert.ok(!navigation.includes("rol === 'ADMIN'"), 'Restaurant visibility must remain permission-backed');

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

console.log('PANEL STRUCTURAL CANONICAL 11-ITEM NAVIGATION SMOKE OK');