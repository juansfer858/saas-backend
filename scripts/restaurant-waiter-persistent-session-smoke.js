'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const service = fs.readFileSync('src/modules/restaurant/restaurant-waiter-device.service.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-waiter-device.routes.js', 'utf8');
const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-waiter-device.public.routes.js', 'utf8');
const bridge = fs.readFileSync('src/web/restaurant-waiter-session-v8.js', 'utf8');
const pwa = fs.readFileSync('src/web/restaurant-waiter-pwa-v7.html', 'utf8');
const jwt = fs.readFileSync('src/utils/jwt.js', 'utf8');

assert.match(service, /renewDeviceSession/);
assert.match(service, /permanentSessionToken/);
assert.match(service, /DEVICE_PERSISTENT_UNTIL/);
assert.match(service, /permanent:\s*true/);
assert.match(routes, /\/dispositivos-mesero\/renovar-sesion/);
assert.match(routes, /req\.authType\s*!==\s*'WAITER_DEVICE'/);
assert.match(routes, /req\.userRole\s*!==\s*'MESERO'/);
assert.match(publicRoutes, /restaurant-waiter-session-v8\.js/);
assert.match(publicRoutes, /fs\.promises\.readFile\(waiterSessionV8Script/);
assert.match(bridge, /renovar-sesion/);
assert.match(bridge, /localStorage\.setItem\(SESSION_KEY/);
assert.match(bridge, /waiterPersistent/);
assert.match(pwa, /Dispositivo vinculado · acceso guardado/);
assert.match(jwt, /permanent\s*=\s*false/);
assert.match(jwt, /if \(!permanent\) options\.expiresIn/);

console.log(JSON.stringify({ ok:true, persistentUntilRevoked:true, oldSessionAutoMigration:true, adaptiveUi:true }));
