'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders-demo-pos-v1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders-demo-pos-v1.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders.html'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-v2-orders.public.routes.js'), 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(runtime.includes("const TENANT='demo-restaurante';"), 'demo tenant guard missing');
expect(runtime.includes("!==TENANT)return;"), 'runtime must no-op outside demo-restaurante');
expect(runtime.includes('VANTIX_DEMO_RESTAURANTE_ORDERS_POS_V1'), 'pilot marker missing');
expect(css.includes('body[data-demo-orders-pos="1"]'), 'scoped CSS guard missing');
expect(css.includes('grid-template-columns:190px minmax(0,1fr) minmax(380px,440px)'), '3-column POS layout missing');
expect(css.includes('grid-template-rows:repeat(2,42px)'), 'categories must stay in exactly two rows');
expect(css.includes('.menu-grid'), 'central product grid missing');
expect(runtime.includes("textContent='Agregar productos'"), 'central products heading missing');
expect(runtime.includes("data-demo-cash>Cobrar"), 'embedded cash action missing');
expect(runtime.includes('/api/v1/restaurante/v2/caja'), 'cash workspace API missing');
expect(runtime.includes('/v2/caja/mesas/'), 'cash table detail/charge API missing');
expect(runtime.includes('/cobrar'), 'real charge endpoint missing');
expect(runtime.includes('/v2/caja/turno/abrir'), 'cash shift opening missing');
expect(runtime.includes('/v2/caja/recibo/imprimir'), 'post-charge print decision API missing');
expect(runtime.includes('/v2/mesas/'), 'prebill table API missing');
expect(runtime.includes('/pedir-cuenta'), 'prebill action missing');
expect(runtime.includes('/app/restaurante-v2/division?tableId='), 'split account handoff missing');
expect(runtime.includes('Cliente genérico'), 'receipt customer name field missing');
expect(html.includes('/app/restaurant-v2-orders-demo-pos-v1.css?v=v1'), 'pilot CSS not loaded');
expect(html.includes('/app/restaurant-v2-orders-demo-pos-v1.js?v=v1'), 'pilot JS not loaded');
expect(routes.includes("router.get('/app/restaurant-v2-orders-demo-pos-v1.css'"), 'pilot CSS route missing');
expect(routes.includes("router.get('/app/restaurant-v2-orders-demo-pos-v1.js'"), 'pilot JS route missing');

for (const rel of [
  'src/modules/restaurant/restaurant-v2-orders.routes.js',
  'src/modules/restaurant/restaurant-v2-cash.routes.js',
  'src/modules/restaurant/restaurant-v2-cash.service.js'
]) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  expect(!source.includes('VANTIX_DEMO_RESTAURANTE_ORDERS_POS_V1'), rel + ' must remain canonical');
}

new Function(runtime);

console.log('DEMO_RESTAURANTE_ORDERS_POS=PASS');
console.log('LAYOUT=UBICACIONES|PRODUCTOS|CUENTA');
console.log('CATEGORY_ROWS=2');
console.log('EMBEDDED_CASH=REAL_V2_CASH_API');
console.log('OTHER_TENANTS=CANONICAL_ORDERS');
