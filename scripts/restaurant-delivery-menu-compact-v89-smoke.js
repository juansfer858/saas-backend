'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const routes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');
const compact = fs.readFileSync('src/web/restaurant-delivery-menu-compact-v89.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');

assert.ok(routes.includes("router.get('/domicilios/carta'"), 'Debe conservarse la carta compacta V89 para rollback');
assert.ok(routes.includes("select: { id: true, nombre: true, precio1: true }"), 'La carta compacta V89 conserva selección mínima');
assert.ok(routes.includes("select: { outputProductId: true }"), 'La validación V89 no debe cargar items completos de recetas');
assert.ok(routes.includes("X-VantixGC-Restaurant-Delivery-Menu', 'compact-v89'"), 'La API compacta debe conservar marcador V89');

assert.match(compact, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.match(compact, /COMPACT_PATH\s*=\s*['"]\/api\/v1\/restaurante\/domicilios\/carta['"]/);
assert.match(compact, /TIMEOUT_MS\s*=\s*8000/);
assert.match(compact, /previousFetch\(mappedUrl\(input\)/);

assert.ok(publicRoutes.includes("router.get('/app/restaurant-delivery-menu-compact-v89.js'"), 'Debe seguir disponible el asset V89 para rollback');
assert.ok(publicRoutes.includes("X-VantixGC-Restaurant-Delivery-Menu-Compact', 'v89'"), 'El asset V89 debe seguir siendo verificable');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const compactSrc = '/app/restaurant-delivery-menu-compact-v89.js?v=v89';
const sharedSrc = '/app/restaurant-delivery-shared-menu-v90.js?v=v90';
assert.ok(html.includes(guardSrc), 'Se conserva el guard V88');

if (html.includes(sharedSrc)) {
  assert.ok(!html.includes(compactSrc), 'V90 debe desactivar el interceptor compacto V89 en la superficie activa');
} else {
  assert.ok(html.includes(compactSrc), 'Sin V90, Domicilios debe seguir cargando V89');
}

console.log('RESTAURANT DELIVERY MENU COMPACT V89 / V90 COMPAT SMOKE OK');
