'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const routes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');
const compact = fs.readFileSync('src/web/restaurant-delivery-menu-compact-v89.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');

assert.ok(routes.includes("router.get('/domicilios/carta'"), 'Debe existir la carta compacta exclusiva de Domicilios');
assert.ok(routes.includes("select: { id: true, nombre: true, precio1: true }"), 'La carta compacta solo debe traer los campos de producto necesarios');
assert.ok(routes.includes("select: { outputProductId: true }"), 'La validación de receta no debe cargar los items completos de cada receta');
assert.ok(routes.includes("X-VantixGC-Restaurant-Delivery-Menu', 'compact-v89'"), 'La API compacta debe exponer marcador V89');

assert.match(compact, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.match(compact, /COMPACT_PATH\s*=\s*['"]\/api\/v1\/restaurante\/domicilios\/carta['"]/);
assert.match(compact, /TIMEOUT_MS\s*=\s*8000/);
assert.match(compact, /previousFetch\(mappedUrl\(input\)/);

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-menu-compact-v89.js'"), 'Debe servirse el redirect V89');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Menu-Compact', 'v89'"), 'El asset V89 debe ser verificable');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const compactSrc = '/app/restaurant-delivery-menu-compact-v89.js?v=v89';
const uiSrc = '/app/restaurant-delivery-ui.js?v=v89';
assert.ok(html.includes(guardSrc), 'Se conserva el guard V88');
assert.ok(html.includes(compactSrc), 'Domicilios debe cargar V89');
assert.ok(html.includes(uiSrc), 'El UI debe invalidar cache con V89');
assert.ok(html.indexOf(guardSrc) < html.indexOf(compactSrc), 'V88 debe instalarse antes de V89');
assert.ok(html.indexOf(compactSrc) < html.indexOf(uiSrc), 'V89 debe interceptar la carta antes del UI');

console.log('RESTAURANT DELIVERY MENU COMPACT V89 SMOKE OK');
