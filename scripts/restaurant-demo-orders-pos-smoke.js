'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders-demo-pos-v1.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders-demo-pos-v1.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/web/restaurant-v2-orders.html'), 'utf8');
const demoRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-demo-bar.routes.js'), 'utf8');
const coreRoutes = fs.readFileSync(path.join(root, 'src/routes/core.routes.js'), 'utf8');
const cashRoutes = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-v2-cash.routes.js'), 'utf8');
const demoService = fs.readFileSync(path.join(root, 'src/modules/restaurant/restaurant-demo-bar-accounts-v1.service.js'), 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(runtime.includes("const TENANT='demo-restaurante';"), 'demo tenant guard missing');
expect(runtime.includes("!==TENANT)return;"), 'runtime must no-op outside demo-restaurante');
expect(runtime.includes('VANTIX_DEMO_RESTAURANTE_BAR_ORDERS_V1'), 'Vantix Bar behavior marker missing');
expect(css.includes('body[data-demo-bar-orders="1"]'), 'scoped demo CSS missing');
expect(css.includes('grid-template-columns:185px minmax(330px,34vw) minmax(600px,1fr)'), 'layout must keep products narrower than account');
expect(css.includes('grid-template-rows:repeat(2,40px)'), 'categories must remain in exactly two rows');
expect(runtime.includes('/v2/demo-bar/workspace'), 'multi-account workspace API missing');
expect(runtime.includes('/demo-bar/mesas/'), 'new account API missing');
expect(runtime.includes('/demo-bar/cuentas/'), 'account actions API missing');
expect(runtime.includes('async function ensureAccount()'), 'auto-create account behavior missing');
expect(runtime.includes("name:'Cuenta'"), 'auto-created account default missing');
expect(runtime.includes("raw.match(/^(\\d+)\\s*\\+\\s*(.*)$/)"), 'quantity + search behavior missing');
expect(runtime.includes('/pedido/enviar'), 'direct send to production missing');
expect(runtime.includes('/pedir-cuenta'), 'prebill behavior missing');
expect(runtime.includes('function openPrebill()'), 'prebill preview behavior missing');
expect(runtime.includes('function printPrebill()'), 'prebill print behavior missing');
expect(runtime.includes("const CAN_EDIT_PRICE=new Set(['ADMIN','SUPER_ADMIN','CAJERO'])"), 'waiter price permission behavior missing');
expect(runtime.includes('/demo-bar/cuentas/'+""), 'demo account route construction missing');
expect(runtime.includes('/caja'), 'embedded cash behavior missing');
expect(runtime.includes('/cobrar'), 'exact-account charge missing');
expect(runtime.includes('/recibo/imprimir'), 'print decision missing');
expect(runtime.includes('async function splitSelectedDraft()'), 'split behavior missing');
expect(runtime.includes('async function mergeDraftAccount()'), 'merge behavior missing');
expect(runtime.includes('data-demo-rename'), 'rename action missing');
expect(runtime.includes('data-demo-close-account'), 'close account action missing');
expect(demoRoutes.includes("/v2/demo-bar/workspace"), 'demo workspace route missing');
expect(demoRoutes.includes("/v2/demo-bar/mesas/:tableId/cuentas"), 'demo account create route missing');
expect(coreRoutes.includes('restaurantDemoBarRouter'), 'isolated demo router must be mounted');
expect(cashRoutes.includes("/v2/demo-bar/cuentas/:sessionId/caja"), 'exact account cash detail route missing');
expect(cashRoutes.includes("/v2/demo-bar/cuentas/:sessionId/cobrar"), 'exact account charge route missing');
expect(demoService.includes("const DEMO_TENANT = 'demo-restaurante';"), 'service tenant guard missing');
expect(demoService.includes('restaurantTableSession.create'), 'accounts must be real restaurant sessions');
expect(html.includes('/app/restaurant-v2-orders-demo-pos-v1.js?v=v1'), 'demo runtime not loaded');
expect(html.includes('/app/restaurant-v2-orders-demo-pos-v1.css?v=v1'), 'demo style not loaded');

new Function(runtime);
new Function(demoService);

console.log('DEMO_BAR_BEHAVIOR_STATIC=PASS');
console.log('FLOW=LOCATION->MULTIPLE_ACCOUNTS->CONSUMPTION');
console.log('SEARCH=QTY+NAME_OR_CODE');
console.log('CASH=EXACT_SESSION');
console.log('OTHER_TENANTS=CANONICAL_PEDIDOS');
