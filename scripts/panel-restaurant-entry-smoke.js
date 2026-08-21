const assert = require('node:assert/strict');
const fs = require('node:fs');

const navigation = fs.readFileSync('src/web/panel-restaurant-entry.js', 'utf8');
const app = fs.readFileSync('src/app.js', 'utf8');

assert.ok(navigation.includes("const NAV_VERSION = 'core-nav-v4'"));
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

assert.ok(navigation.includes('observer.disconnect()'));
assert.ok(navigation.includes('observerStarted'));
assert.ok(navigation.includes('installing'));
assert.ok(navigation.includes('window.setTimeout'));
assert.ok(!navigation.includes('queueMicrotask('), 'Do not schedule self-triggered MutationObserver work as microtasks');
assert.ok(navigation.includes('async function start()'));
assert.ok(navigation.includes('await refreshEntry();'));

assert.ok(app.includes("app.get('/app/panel-restaurant-entry.js'"));
assert.ok(app.includes("res.set('Cache-Control', 'no-store')"));
assert.ok(app.includes('core-nav-anti-flash'));
assert.ok(app.includes('/app/panel-restaurant-entry.js?v=core-nav-v4'));
assert.ok(app.includes('tenantNavigationTag'));
for (const route of ['/app/ventas', '/app/compras', '/app/configuracion-avanzada', '/app/contabilidad']) {
  assert.ok(app.includes(`app.get('${route}'`), `Falta ruta ${route}`);
}
assert.ok(app.includes('sendTenantHtml(salesHtmlPath, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(purchasesHtmlPath, res, next, [tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(platformCoreConfigHtmlPath, res, next, [notificationsTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(accountingHtmlPath, res, next, [guardTag, tenantNavigationTag])'));
assert.ok(app.includes('sendTenantHtml(panelHtmlPath, res, next, [integrationTag, tenantNavigationTag])'));

console.log('PANEL CANONICAL 11-ITEM NAVIGATION + NO-FLICKER/CACHE GUARD SMOKE OK');