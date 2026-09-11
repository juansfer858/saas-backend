'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const shared = fs.readFileSync('src/web/restaurant-delivery-shared-menu-v90.js', 'utf8');
const waiter = fs.readFileSync('src/web/restaurant-waiter-runtime-v7.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

assert.match(shared, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.match(waiter, /api\('\/api\/v1\/restaurante\/menu'\)/);
assert.match(shared, /MENU_PAGE\s*=\s*40/);
assert.match(waiter, /MENU_PAGE\s*=\s*40/);
assert.ok(shared.includes("sameMenuAsWaiter:true"), 'Domicilios debe declarar fuente de carta compartida');
assert.ok(shared.includes("requiresTable:false"), 'Domicilios no debe crear ni exigir mesa');
assert.ok(shared.includes("event.stopImmediatePropagation()"), 'V90 debe impedir que se ejecute el render masivo histórico');
assert.ok(shared.includes("const DELIVERY_PATH = '/api/v1/restaurante/domicilios'"), 'El pedido debe seguir perteneciendo al dominio Domicilios');
assert.ok(!shared.includes('/api/v1/restaurante/domicilios/carta'), 'V90 no debe usar la carta compacta separada');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const compactSrc = '/app/restaurant-delivery-menu-compact-v89.js?v=v89';
const sharedSrc = '/app/restaurant-delivery-shared-menu-v90.js?v=v90';
const successorSrc = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
const lazyUiSrc = '/app/restaurant-delivery-ui.js?v=v92';
const successorActive = html.includes(successorSrc);
const lazyActive = html.includes(lazyUiSrc);
const uiSrc = lazyActive ? lazyUiSrc : successorActive ? '/app/restaurant-delivery-ui.js?v=v91' : '/app/restaurant-delivery-ui.js?v=v90';

assert.ok(html.includes(guardSrc), 'Se conserva el timeout recuperable V88');
assert.ok(html.includes(uiSrc), 'El UI base debe usar el cache bust de la superficie activa');
assert.ok(!html.includes(compactSrc), 'La carta compacta V89 ya no debe interceptar Domicilios');

if (successorActive) {
  assert.ok(!html.includes(sharedSrc), 'Con V91/V92 activo, V90 debe quedar sólo como rollback servido');
  assert.ok(html.indexOf(uiSrc) < html.indexOf(successorSrc), 'La superficie activa debe declarar el sucesor después del UI base');
} else {
  assert.ok(html.includes(sharedSrc), 'Sin sucesor activo, Domicilios debe cargar la carta compartida V90');
  assert.ok(html.indexOf(uiSrc) < html.indexOf(sharedSrc), 'V90 debe capturar el botón después de cargar el UI base');
}

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-shared-menu-v90.js'"), 'El asset V90 debe seguir servido para rollback');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Shared-Menu', 'v90'"), 'El asset V90 debe exponer marcador verificable');

console.log(`RESTAURANT DELIVERY SHARED MENU V90 SMOKE OK · ${lazyActive ? 'ROLLBACK BEHIND V92' : successorActive ? 'ROLLBACK BEHIND V91' : 'ACTIVE'}`);
