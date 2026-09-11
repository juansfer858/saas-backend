'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const v91 = fs.readFileSync('src/web/restaurant-delivery-orders-menu-v91.js', 'utf8');
const v92 = fs.readFileSync('src/web/restaurant-delivery-lazy-menu-v92.js', 'utf8');
const v93 = fs.readFileSync('src/web/restaurant-delivery-orders-compact-v93.js', 'utf8');
const orders = fs.readFileSync('src/web/restaurant-v2-orders.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

assert.ok(orders.includes("RV2.api('/api/v1/restaurante/menu')"), 'Pedidos conserva su fuente normal');
assert.ok(v91.includes("sameMenuAsOrders:true"), 'V91 se conserva como rollback');
assert.ok(v92.includes("loadOnModuleEntry:false"), 'V92 se conserva como rollback sin carga al entrar');
assert.ok(v93.includes("sameProductsAsOrders:true"), 'V93 debe declarar mismos productos de Pedidos');
assert.ok(v93.includes("sameVisualContractAsOrders:true"), 'V93 debe declarar el contrato visual de Pedidos');
assert.ok(v93.includes("const MENU_PATH = '/api/v1/restaurante/domicilios/carta'"), 'V93 debe usar la carta compacta');
assert.ok(v93.includes('PAGE_SIZE = 24'), 'V93 debe limitar el render inicial');
assert.ok(v93.includes("requiresTable:false"), 'Domicilios no debe requerir mesa');
assert.ok(v93.includes('event.stopImmediatePropagation()'), 'V93 debe bloquear el flujo histórico');
assert.ok(v93.includes('menu-grid') && v93.includes('menu-item') && v93.includes('+ Agregar'), 'V93 debe conservar la UI de Pedidos');
assert.ok(!v93.includes("/api/v1/restaurante/menu'"), 'V93 no debe volver a solicitar la carta pesada de Pedidos');

const uiV93 = '/app/restaurant-delivery-ui.js?v=v93';
const activeV93 = '/app/restaurant-delivery-orders-compact-v93.js?v=v93';
const rollbackV92 = '/app/restaurant-delivery-lazy-menu-v92.js?v=v92';
const rollbackV91 = '/app/restaurant-delivery-orders-menu-v91.js?v=v91';
assert.ok(html.includes(uiV93), 'Domicilios debe invalidar caché en V93');
assert.ok(html.includes(`<script src="${activeV93}"></script>`), 'V93 debe ser la superficie activa');
assert.ok(html.includes(rollbackV92), 'V92 debe quedar declarado como rollback');
assert.ok(html.includes(rollbackV91), 'V91 debe quedar declarado como rollback');
assert.ok(!html.includes(`<script src="${rollbackV92}"></script>`), 'V92 no debe ejecutarse');
assert.ok(!html.includes(`<script src="${rollbackV91}"></script>`), 'V91 no debe ejecutarse');
assert.ok(html.indexOf(uiV93) < html.indexOf(activeV93), 'V93 debe capturar Nuevo domicilio después del UI base');

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-orders-compact-v93.js'"));
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Orders-Compact', 'v93'"));
assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-lazy-menu-v92.js'"));
assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-orders-menu-v91.js'"));
assert.ok(!publicRoutes.includes("fs.promises.readFile(deliveryLazyMenu, 'utf8')"), 'V92 no debe quedar embebido en el bundle activo');

console.log('RESTAURANT DELIVERY ORDERS V91/V92 ROLLBACK + COMPACT V93 ACTIVE SMOKE OK');
