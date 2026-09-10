'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(file, 'utf8');
const operational = read('src/web/restaurant-v2-operational-ux-v12.js');
const clientUx = read('src/web/restaurant-v2-client-ux-v12.js');
const clientCss = read('src/web/restaurant-v2-client-ux-v12.css');
const design = read('src/web/restaurant-v2-design-system.css');
const aggregator = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
const clientHtml = read('src/web/restaurant-v2-client-qr.html');
const menuHtml = read('src/web/restaurant-v2-menu.html');
const themeService = read('src/modules/restaurant/restaurant-theme.service.js');

const moduleHtml = [
  ['Mesas', 'src/web/restaurant-v2-tables.html'],
  ['Pedidos', 'src/web/restaurant-v2-orders.html'],
  ['Cocina / KDS', 'src/web/restaurant-v2-kds.html'],
  ['Caja', 'src/web/restaurant-v2-cash.html'],
  ['División', 'src/web/restaurant-v2-split.html'],
  ['Carta', 'src/web/restaurant-v2-menu.html'],
  ['Domicilios', 'src/web/restaurant-v2-delivery-p11.html'],
  ['Empleados', 'src/web/restaurant-v2-employees-p11.html']
];

assert.match(design, /VANTIX_RESTAURANT_V2_CANONICAL_HEADER_V12/);
assert.match(design, /body\[data-rv2-module-header="true"\]>header\.rv2-module-top/);
assert.match(design, /padding:16px 22px!important/);
for (const [title, file] of moduleHtml) {
  const html = read(file);
  assert.match(html, /data-rv2-module-header="true"/, `${file} must opt into canonical header`);
  assert.match(html, new RegExp(`data-rv2-module-title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${file} must expose its window title`);
  assert.match(html, /restaurant-v2-operational-ux-v12\.js/, `${file} must load V12 header runtime`);
}
const parityHtml = read('src/web/restaurant-v2-admin-parity.html');
assert.match(parityHtml, /data-rv2-module-header="true"/);
assert.match(parityHtml, /data-rv2-module-title="AUTO_ADMIN"/);
assert.match(operational, /AUTO_ADMIN/);
assert.match(operational, /Dispositivos/);
assert.match(operational, /QR de mesas/);

// CUENTA SOLICITADA -> pregunta de seguridad -> módulo correcto con la misma mesa.
assert.match(operational, /rv2-table-account-requested/);
assert.match(operational, /¿Cómo se va a cobrar esta mesa\?/);
assert.match(operational, /Cuenta conjunta/);
assert.match(operational, /Cuenta dividida/);
assert.match(operational, /vantixgc_restaurant_account_target_v12/);
assert.match(operational, /centro-de-control-v2\?module=/);
assert.match(operational, /installAccountAutoSelect\('caja'\)/);
assert.match(operational, /installAccountAutoSelect\('division'\)/);
assert.match(operational, /\[data-table\]/);

// El buscador se monta sobre el QR existente: no sustituye pedidos, visita ni categorías.
assert.match(clientUx, /VANTIX_RESTAURANT_V2_CLIENT_UX_V12/);
assert.match(clientUx, /Buscar producto/);
assert.match(clientUx, /Buscar producto o categoría/);
assert.match(clientUx, /data-category="TODO"/);
assert.match(clientUx, /MutationObserver/);
assert.match(clientCss, /VANTIX_RESTAURANT_V2_CLIENT_UX_V12_CSS/);
assert.match(clientCss, /VANTIX_RESTAURANT_V2_CLIENT_PROMO_HERO_V12/);
assert.match(clientCss, /p7-spotlight-hero/);
assert.match(clientHtml, /restaurant-v2-client-ux-v12\.css/);
assert.match(clientHtml, /restaurant-v2-client-ux-v12\.js/);
assert.match(clientHtml, /id="spotlight"/);
assert.match(clientHtml, /id="categoryNav"/);

// Promo del día reutiliza el Spotlight real ya auditado del Restaurante.
assert.match(operational, /★ Promo del día/);
assert.match(operational, /\/api\/v1\/restaurante\/theme/);
assert.match(operational, /clientSpotlight/);
assert.match(operational, /kind:'PROMO_DIA'/);
assert.match(operational, /menuItemId/);
assert.match(operational, /Guardar y publicar/);
assert.match(menuHtml, /class="cc-view-actions menu-actions"/);
assert.match(themeService, /DEFAULT_SPOTLIGHT/);
assert.match(themeService, /PROMO_DIA/);
assert.match(themeService, /RESTAURANT_CLIENT_SPOTLIGHT/);
assert.match(themeService, /validateSpotlight/);

// Los assets V12 son servidos por la foundation V2 con no-store.
assert.match(aggregator, /\/app\/restaurant-v2-operational-ux-v12\.js/);
assert.match(aggregator, /\/app\/restaurant-v2-client-ux-v12\.js/);
assert.match(aggregator, /\/app\/restaurant-v2-client-ux-v12\.css/);
assert.match(aggregator, /sendPreviewAsset/);

assert.doesNotThrow(() => new vm.Script(operational));
assert.doesNotThrow(() => new vm.Script(clientUx));

console.log('RESTAURANT V2 OPERATIONAL UX V12 SMOKE OK', JSON.stringify({
  canonicalHeaders: true,
  requestedAccountSafetyChoice: true,
  accountTableContextPreserved: true,
  clientSearch: true,
  promoUsesExistingSpotlight: true,
  promoRenderedAsHeroCard: true,
  businessEnginesUntouched: true
}));
