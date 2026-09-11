'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('src/web/restaurant-v2-delivery-p11.html', 'utf8');
const guard = fs.readFileSync('src/web/restaurant-delivery-menu-guard-v88.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-delivery.public.routes.js', 'utf8');

const guardSrc = '/app/restaurant-delivery-menu-guard-v88.js?v=v88';
const uiSrc = '/app/restaurant-delivery-ui.js?v=v88';

assert.ok(html.includes(guardSrc), 'Domicilios debe cargar el guard V88');
assert.ok(html.includes(uiSrc), 'Domicilios debe invalidar cache del UI junto con V88');
assert.ok(html.indexOf(guardSrc) < html.indexOf(uiSrc), 'El guard debe instalarse antes del UI de Domicilios');

assert.match(guard, /MENU_PATH\s*=\s*['"]\/api\/v1\/restaurante\/menu['"]/);
assert.match(guard, /MENU_TIMEOUT_MS\s*=\s*12000/);
assert.match(guard, /new AbortController\(\)/);
assert.match(guard, /controller\.abort\(\)/);
assert.match(guard, /La carta tardó demasiado en responder/);
assert.match(guard, /\.finally\(\(\)\s*=>/);
assert.match(guard, /clearTimeout\(timer\)/);

assert.ok(routes.includes("router.get('/app/restaurant-delivery-menu-guard-v88.js'"), 'El guard V88 debe estar servido por el router público');
assert.ok(routes.includes("X-VantixGC-Restaurant-Delivery-Menu-Guard', 'v88'"), 'La ruta V88 debe exponer marcador verificable');

console.log('RESTAURANT DELIVERY MENU LOADER V88 SMOKE OK');
