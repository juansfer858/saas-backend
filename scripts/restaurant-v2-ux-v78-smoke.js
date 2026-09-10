'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (path) => fs.readFileSync(path, 'utf8');
const uxJs = read('src/web/restaurant-v2-ux-v78.js');
const uxCss = read('src/web/restaurant-v2-ux-v78.css');
const tablesHtml = read('src/web/restaurant-v2-tables.html');
const tablesJs = read('src/web/restaurant-v2-tables.js');
const ordersHtml = read('src/web/restaurant-v2-orders.html');
const kdsHtml = read('src/web/restaurant-v2-kds.html');
const cashHtml = read('src/web/restaurant-v2-cash.html');
const cashJs = read('src/web/restaurant-v2-cash.js');
const splitHtml = read('src/web/restaurant-v2-split.html');
const splitJs = read('src/web/restaurant-v2-split.js');
const menuHtml = read('src/web/restaurant-v2-menu.html');
const menuSpotJs = read('src/web/restaurant-v2-menu-spotlight-v1.js');
const menuSpotCss = read('src/web/restaurant-v2-menu-spotlight-v1.css');
const adminHtml = read('src/web/restaurant-v2-admin-parity.html');
const deliveryHtml = read('src/web/restaurant-v2-delivery-p11.html');
const employeesHtml = read('src/web/restaurant-v2-employees-p11.html');
const nativeHtml = read('src/web/restaurant-v2-native-control-p11.html');
const clientHtml = read('src/web/restaurant-v2-client-qr.html');
const clientSearchJs = read('src/web/restaurant-v2-client-search-p8.js');
const clientExperienceCss = read('src/web/restaurant-v2-client-experience-p8.css');
const themeService = read('src/modules/restaurant/restaurant-theme.service.js');
const restaurantRoutes = read('src/modules/restaurant/restaurant.routes.js');
const operationalRoutes = read('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js');
const clientRoutes = read('src/modules/restaurant/restaurant-v2-client-qr.public.routes.js');
const menuRoutes = read('src/modules/restaurant/restaurant-v2-menu.public.routes.js');

assert.match(uxJs, /VANTIX_RESTAURANT_V2_UX_V78/);
assert.match(uxCss, /VANTIX_RESTAURANT_V2_UX_V78/);
assert.doesNotThrow(() => new vm.Script(uxJs));
assert.match(uxJs, /'\/app\/restaurante-v2\/mesas','Mesas'/);
assert.match(uxJs, /'\/app\/restaurante-v2\/pedidos','Pedidos'/);
assert.match(uxJs, /'\/app\/restaurante-v2\/kds','Cocina \/ KDS'/);
assert.match(uxJs, /'\/app\/restaurante-v2\/caja','Caja'/);
assert.match(uxJs, /'\/app\/restaurante-v2\/division','División'/);
assert.match(uxJs, /'\/app\/restaurante-v2\/carta','Carta'/);
assert.match(uxCss, /\.kds-top,\.rv2-top,\.rv2-order-top,\.cash-top,\.split-top,\.menu-top,\.admin-top,\.rv2-v78-top/);
assert.match(uxCss, /padding:12px 18px!important/);

for (const html of [tablesHtml, ordersHtml, kdsHtml, cashHtml, splitHtml, menuHtml, adminHtml, deliveryHtml, employeesHtml]) {
  assert.match(html, /restaurant-v2-ux-v78\.css/);
  assert.match(html, /restaurant-v2-ux-v78\.js/);
}
assert.match(deliveryHtml, /<h1>Domicilios<\/h1>/);
assert.match(employeesHtml, /<h1>Empleados<\/h1>/);
assert.match(nativeHtml, /restaurant-v2-ux-v78\.js/);
assert.match(operationalRoutes, /restaurant-v2-ux-v78\.css/);
assert.match(operationalRoutes, /restaurant-v2-ux-v78\.js/);

// Cuenta solicitada: primero se decide conjunta/dividida y luego se conserva el tableId.
assert.match(tablesJs, /CUENTA SOLICITADA/);
assert.match(uxJs, /¿Cómo se va a cobrar esta mesa\?/);
assert.match(uxJs, /Cuenta conjunta/);
assert.match(uxJs, /Cuenta dividida/);
assert.match(uxJs, /VANTIX_RESTAURANT_V2_OPEN_MODULE_V78/);
assert.match(uxJs, /module==='caja'/);
assert.match(uxJs, /module==='division'/);
assert.match(uxJs, /tableId/);
assert.match(uxJs, /#queue \[data-table\]/);
assert.match(cashJs, /data-table=/);
assert.match(splitJs, /data-table=/);

// QR cliente: búsqueda visible y sin alterar carrito/categorías del P7.
assert.match(clientHtml, /id="menuSearch"/);
assert.match(clientHtml, /id="menuSearchButton"/);
assert.match(clientHtml, /restaurant-v2-client-search-p8\.js/);
assert.match(clientHtml, /restaurant-v2-client-experience-p8\.css/);
assert.match(clientSearchJs, /VANTIX_RESTAURANT_V2_CLIENT_SEARCH_P8/);
assert.match(clientSearchJs, /searchesNameAndCategory:true/);
assert.match(clientSearchJs, /data-category="TODO"/);
assert.doesNotThrow(() => new vm.Script(clientSearchJs));
assert.match(clientExperienceCss, /\.p7-search/);
assert.match(clientRoutes, /restaurant-v2-client-search-p8\.js/);
assert.match(clientRoutes, /restaurant-v2-client-experience-p8\.css/);

// Promo del día: reutiliza clientSpotlight y aparece antes de categorías como tarjeta destacada.
assert.match(menuSpotJs, /VANTIX_RESTAURANT_V2_MENU_SPOTLIGHT_V1/);
assert.match(menuSpotJs, /★ Promo del día/);
assert.match(menuSpotJs, /\/api\/v1\/restaurante\/theme/);
assert.match(menuSpotJs, /kind:'PROMO_DIA'/);
assert.match(menuSpotJs, /clientSpotlight/);
assert.match(menuSpotJs, /frontCard:true/);
assert.doesNotThrow(() => new vm.Script(menuSpotJs));
assert.match(menuSpotCss, /\.menu-promo-preview/);
assert.match(menuHtml, /restaurant-v2-menu-spotlight-v1\.js/);
assert.match(menuHtml, /restaurant-v2-menu-spotlight-v1\.css/);
assert.match(menuRoutes, /restaurant-v2-menu-spotlight-v1\.js/);
assert.match(menuRoutes, /restaurant-v2-menu-spotlight-v1\.css/);
assert.match(clientHtml, /id="spotlight"[\s\S]*id="menuSearch"[\s\S]*id="categoryNav"/);
assert.match(clientExperienceCss, /\.p7-spotlight/);
assert.match(themeService, /clientSpotlight/);
assert.match(restaurantRoutes, /\/theme/);

console.log('RESTAURANT V2 UX V78 SMOKE OK', JSON.stringify({
  canonicalHeaders:true,
  requestedAccountSafetyChoice:true,
  contextualTableSelection:true,
  clientSearch:true,
  promoFrontCard:true,
  reusesClientSpotlight:true
}));
