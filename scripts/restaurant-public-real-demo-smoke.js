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

assert.match(modal, /DEMO_PATH = '\/restaurantes\/demo\?embedded=1'/);
assert.match(modal, /sandbox=\"allow-scripts\"/);
assert.doesNotMatch(modal, /allow-same-origin/);
assert.match(modal, /referrerpolicy=\"no-referrer\"/);
assert.match(modal, /Showcase autónomo/);

console.log('RESTAURANT PUBLIC STANDALONE DEMO SMOKE OK', JSON.stringify({
  standalone:true,
  noTenantSession:true,
  noCoreApi:true,
  cspNoConnect:true,
  modalSandbox:true,
  adminShowcaseProtected:true
}));
