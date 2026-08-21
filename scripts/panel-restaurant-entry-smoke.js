const assert = require('node:assert/strict');
const fs = require('node:fs');

const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');

// One canonical runtime list owns the tenant sidebar order. Legacy per-module
// sidebars may exist as HTML fallback, but every rendered Core module is
// normalized from this single list.
assert.ok(navigation.includes('const CORE_NAV_ITEMS = Object.freeze(['));
assert.equal((navigation.match(/const CORE_NAV_ITEMS =/g) || []).length, 1);
assert.ok(navigation.includes('window.VantixGCCoreNavigation = CORE_NAV_ITEMS'));
assert.ok(navigation.includes('installCoreNavigationParity'));

const expected = [
  ["'/app/dashboard'", "'Dashboard'"],
  ["'/app/restaurante'", "'Restaurante'"],
  ["'/app/ventas'", "'Ventas'"],
  ["'/app/compras'", "'Compras'"],
  ["'/app/inventario'", "'Inventarios / Kardex'"],
  ["'/app/tesoreria'", "'Tesorería & Bancos'"],
  ["'/app/cartera'", "'Cartera'"],
  ["'/app/terceros'", "'Terceros'"],
  ["'/app/contabilidad'", "'Contabilidad'"],
  ["'/app/configuracion'", "'Parametrización Contable'"],
  ["'/app/configuracion-avanzada'", "'Configuración avanzada'"]
];

let cursor = -1;
for (const [href, label] of expected) {
  const hrefAt = navigation.indexOf(`href: ${href}`, cursor + 1);
  const labelAt = navigation.indexOf(`label: ${label}`, hrefAt);
  assert.ok(hrefAt > cursor, `Ruta fuera de orden o ausente: ${href}`);
  assert.ok(labelAt > hrefAt, `Etiqueta ausente para ${href}: ${label}`);
  cursor = hrefAt;
}

assert.ok(navigation.includes("heading.textContent = 'Parametrización Contable'"));
assert.ok(navigation.includes("'/api/v1/restaurante/ui-context'"));
assert.ok(navigation.includes('restaurantOnly: true'));
assert.ok(navigation.includes('data-restaurant-entry'));
assert.ok(navigation.includes('Abrir Restaurante'));
assert.ok(!navigation.includes("rol === 'ADMIN'"), 'Restaurant visibility must be permission-backed, not hardcoded to ADMIN');

// Canonical navigation is served once and injected into every tenant Core
// surface that owns the shared sidebar, including Accounting and Advanced Config.
assert.ok(app.includes("app.get('/app/panel-restaurant-entry.js'"));
assert.ok(app.includes('tenantNavigationTag'));
for (const route of ['/app/ventas', '/app/compras', '/app/configuracion-avanzada', '/app/contabilidad']) {
  assert.ok(app.includes(`app.get('${route}'`), `Falta ruta ${route}`);
}
assert.ok(app.includes('sendTenantHtml(salesHtmlPath, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(purchasesHtmlPath, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(platformCoreConfigHtmlPath, res, next, [notificationsTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(accountingHtmlPath, res, next, [guardTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(panelHtmlPath, res, next, [integrationTag, tenantNavigationTag])'));

console.log('PANEL CANONICAL 11-ITEM NAVIGATION + RESTAURANT ENTRY SMOKE OK');