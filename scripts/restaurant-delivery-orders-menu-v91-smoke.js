'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const delivery = fs.readFileSync('src/web/restaurant-delivery-orders-menu-v91.js', 'utf8');
const lazy = fs.readFileSync('src/web/restaurant-delivery-lazy-menu-v92.js', 'utf8');
const orders = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

assert.match(delivery, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.ok(orders.includes("RV2.api('/api/v1/restaurante/menu')"), 'Pedidos debe conservar la misma fuente de carta');
assert.ok(delivery.includes("sameMenuAsOrders:true"), 'V91 conserva la carta de Pedidos como contrato');
assert.ok(delivery.includes("sameVisualContractAsOrders:true"), 'V91 conserva el contrato visual de Pedidos');
assert.ok(delivery.includes("requiresTable:false"), 'Domicilios no debe crear ni exigir mesa');
assert.ok(delivery.includes("event.stopImmediatePropagation()"), 'V91 debe impedir el render histórico de Domicilios cuando se activa');
assert.ok(delivery.includes("const DELIVERY_PATH = '/api/v1/restaurante/domicilios'"), 'El pedido debe seguir perteneciendo a Domicilios');

for (const token of [
  "['TODAS', ...new Set(menu.map((row) => row.displayCategory || row.category || 'MENÚ'))]",
  "item.displayCategory || item.category || 'MENÚ'",
  'menu-grid',
  'menu-item',
  'rv2-btn rv2-btn-primary',
  '+ Agregar',
  'Buscar en toda la carta…'
]) assert.ok(delivery.includes(token), `Falta contrato visual/funcional de Pedidos: ${token}`);

assert.ok(!delivery.includes('Cargando la misma carta'), 'No debe reaparecer la pantalla de carga reportada');
assert.ok(!delivery.includes('Cargando carta'), 'V91 no debe abrir un placeholder de carga');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const uiSrc = '/app/restaurant-delivery-ui.js?v=v92';
const v91Src = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
const v90Src = '/app/restaurant-delivery-shared-menu-v90.js?v=v90';
assert.ok(html.includes(guardSrc), 'Se conserva V88 como protección');
assert.ok(html.includes(uiSrc), 'Domicilios debe usar el bundle V92');
assert.ok(html.includes(v91Src), 'La ruta V91 debe quedar declarada para rollback/carga diferida');
assert.ok(!html.includes(`<script src="${v91Src}"></script>`), 'V91 no debe ejecutarse al entrar al módulo');
assert.ok(!html.includes(v90Src), 'V90 no debe interceptar la superficie activa');

assert.ok(lazy.includes("loadOnModuleEntry:false"), 'V92 debe declarar que no carga carta al entrar a Domicilios');
assert.ok(lazy.includes("loadOnNewDelivery:true"), 'V92 debe cargar V91 sólo al pulsar Nuevo domicilio');
assert.ok(lazy.includes("event.stopImmediatePropagation()"), 'V92 debe bloquear el flujo histórico antes de cargar V91');
assert.ok(lazy.includes("document.createElement('script')"), 'V92 debe activar V91 de forma diferida');
assert.ok(!lazy.includes('/api/v1/restaurante/menu'), 'V92 no debe consultar la carta al entrar al módulo');

assert.ok(publicRoutes.includes("deliveryLazyMenu"), 'El bundle público debe incluir V92');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Lazy-Menu', 'v92'"), 'El bundle debe exponer marcador V92');
assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-orders-menu-v91.js'"), 'V91 debe seguir servido para carga diferida/rollback');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Orders-Menu', 'v91'"), 'V91 debe seguir siendo verificable');
assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-shared-menu-v90.js'"), 'V90 debe seguir disponible para rollback');

console.log('RESTAURANT DELIVERY ORDERS MENU V91/V92 LAZY SMOKE OK');
