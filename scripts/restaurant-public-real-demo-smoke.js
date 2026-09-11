'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const installer = read('src/modules/public-installer/public-installer.routes.js');
const core = read('src/routes/core.routes.js');
const demo = read('src/web/restaurant-public-demo.html');
const modal = read('src/web/restaurant-public-demo-modal.js');
const landing = read('src/web/restaurant-public.html');

assert.equal(fs.existsSync('src/modules/restaurant/restaurant-public-demo-access.public.routes.js'), false, 'El demo comercial no debe emitir sesiones/JWT');
assert.equal(fs.existsSync('src/middleware/restaurant-public-demo-guard.js'), false, 'El demo comercial no debe necesitar middleware dentro del Core');

assert.doesNotMatch(installer, /restaurantPublicDemoAccessRouter/);
assert.doesNotMatch(core, /restaurantPublicDemoGuard/);
assert.match(installer, /router\.get\('\/restaurantes\/demo'/);
assert.match(installer, /X-VantixGC-Restaurant-Demo-Isolation/);
assert.match(installer, /standalone-commercial-v1/);
assert.match(installer, /connect-src 'none'/);
assert.match(installer, /frame-src 'none'/);
assert.match(installer, /restaurant-public-demo-modal\.js/);
assert.match(installer, /\/restaurantes\/demo-modal-v1\.js/);
assert.match(installer, /filePath === restaurantLandingPath/);

assert.match(landing, /\/restaurantes\/demo/);
assert.match(demo, /MODO DEMOSTRACIÓN/);
assert.match(demo, /AISLADO DEL SISTEMA REAL/);
assert.match(demo, /Showcase comercial/);
assert.match(demo, /ENVIAR A COCINA \/ BARRA/);
assert.match(demo, /COBRAR EN EL DEMO/);
assert.match(demo, /PROTEGIDO/);
assert.match(demo, /const initialState/);
assert.match(demo, /renderProtected/);

// El showcase debe verse como la interfaz V2 que recibe el cliente, no como un rediseño comercial paralelo.
assert.match(demo, /data-demo-ui-parity="restaurant-v2-native-control-p11"/);
assert.match(demo, /RESTAURANTES · V2/);
assert.match(demo, /--side:#111827/);
assert.match(demo, /--side-active:#1f2937/);
assert.match(demo, /--side-accent:#3b82f6/);
assert.match(demo, /--rv2-primary:#ea580c/);
assert.match(demo, /--rv2-table-occupied:#c2410c/);
assert.match(demo, /--rv2-table-account:#dc2626/);
assert.match(demo, /HÍBRIDO · Edge en línea/);
for (const moduleLabel of ['Mesas','Pedidos','Producción','División','Caja','Domicilios','Carta','Empleados','QR de mesas','Dispositivos']) {
  assert.ok(demo.includes(`label:'${moduleLabel}'`), `Falta módulo real V2 en el demo: ${moduleLabel}`);
}
assert.match(demo, /header\('MESAS'/);
assert.match(demo, /header\('PEDIDOS'/);
assert.match(demo, /COCINA\/KDS\/PUSH P6/);
assert.match(demo, /CAJA P4/);
assert.match(demo, /CUENTA SOLICITADA/);

for (const forbidden of [
  /fetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /\/api\//,
  /\/app\//,
  /vantixgc_core_session/i,
  /localStorage/,
  /sessionStorage/,
  /document\.cookie/,
  /demo-restaurante/,
  /PUBLIC_RESTAURANT_DEMO/,
  /<iframe/i
]) assert.doesNotMatch(demo, forbidden, `Demo standalone must not contain ${forbidden}`);

const inlineScripts = [...demo.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.equal(inlineScripts.length, 1, 'Standalone demo must keep one auditable inline runtime');
new Function(inlineScripts[0]);

assert.match(modal, /DEMO_PATH = '\/restaurantes\/demo\?embedded=1'/);
assert.match(modal, /sandbox=\"allow-scripts\"/);
assert.doesNotMatch(modal, /allow-same-origin/);
assert.match(modal, /referrerpolicy=\"no-referrer\"/);
assert.match(modal, /Showcase autónomo/);
new Function(modal);

console.log('RESTAURANT PUBLIC STANDALONE DEMO SMOKE OK', JSON.stringify({
  standalone:true,
  noTenantSession:true,
  noCoreApi:true,
  cspNoConnect:true,
  modalSandbox:true,
  adminShowcaseProtected:true,
  visualParity:'RESTAURANT_V2_P11_CURRENT',
  browserRuntimeParses:true
}));
