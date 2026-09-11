'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const delivery = fs.readFileSync('src/web/restaurant-delivery-orders-menu-v91.js', 'utf8');
const orders = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

assert.match(delivery, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.ok(orders.includes("RV2.api('/api/v1/restaurante/menu')"), 'Pedidos debe conservar la misma fuente de carta');
assert.ok(delivery.includes("sameMenuAsOrders:true"), 'Domicilios debe declarar la carta de Pedidos como contrato');
assert.ok(delivery.includes("sameVisualContractAsOrders:true"), 'Domicilios debe declarar el contrato visual de Pedidos');
assert.ok(delivery.includes("requiresTable:false"), 'Domicilios no debe crear ni exigir mesa');
assert.ok(delivery.includes("preloadMenu().catch(() => {})"), 'La carta debe precargarse al entrar a Domicilios');
assert.ok(delivery.includes("event.stopImmediatePropagation()"), 'V91 debe impedir el render histórico de Domicilios');
assert.ok(delivery.includes("const DELIVERY_PATH = '/api/v1/restaurante/domicilios'"), 'El pedido debe seguir perteneciendo a Domicilios');

// El selector de categorías, búsqueda y tarjeta siguen el contrato que usa Pedidos.
for (const token of [
  "['TODAS', ...new Set(menu.map((row) => row.displayCategory || row.category || 'MENÚ'))]",
  "item.displayCategory || item.category || 'MENÚ'",
  'menu-grid',
  'menu-item',
  'rv2-btn rv2-btn-primary',
  '+ Agregar',
  'Buscar en toda la carta…'
]) assert.ok(delivery.includes(token), `Falta contrato visual/funcional de Pedidos: ${token}`);

assert.ok(!delivery.includes('Cargando la misma carta'), 'No debe existir la pantalla de carga reportada por el usuario');
assert.ok(!delivery.includes('Cargando carta'), 'Nuevo domicilio no debe abrir con un placeholder de carga');
assert.ok(delivery.indexOf('const menu = await preloadMenu();') < delivery.indexOf('const dialog = freshDialog();'), 'La carta debe resolverse antes de mostrar el diálogo');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const uiSrc = '/app/restaurant-delivery-ui.js?v=v91';
const v91Src = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
const v90Src = '/app/restaurant-delivery-shared-menu-v90.js?v=v90';
assert.ok(html.includes(guardSrc), 'Se conserva V88 como protección');
assert.ok(html.includes(uiSrc), 'El UI base debe invalidar caché en V91');
assert.ok(html.includes(v91Src), 'Domicilios debe cargar V91');
assert.ok(!html.includes(v90Src), 'V90 no debe interceptar la superficie activa');
assert.ok(html.indexOf(uiSrc) < html.indexOf(v91Src), 'V91 debe capturar el botón después del UI base');

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-orders-menu-v91.js'"), 'El asset V91 debe servirse por router público');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Orders-Menu', 'v91'"), 'V91 debe exponer marcador verificable');
assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-shared-menu-v90.js'"), 'V90 debe seguir disponible para rollback');

console.log('RESTAURANT DELIVERY ORDERS MENU V91 SMOKE OK');
