'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('src/web/restaurant-v2-cash-print-manager-v103.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-v2-cash.public.routes.js', 'utf8');

assert.match(runtime, /VANTIX_RESTAURANT_CASH_PRINT_MANAGER_V103/);
assert.match(runtime, /Impresora y tirilla/);
assert.match(runtime, /Promise\.allSettled/);
assert.match(runtime, /readSafe:true/);
assert.match(runtime, /adminRoles\.has/);
assert.match(runtime, /\['LAN','WINDOWS'\]/);
assert.match(runtime, /role\|\|''\)\.toUpperCase\(\)==='CAJA'/);
assert.match(runtime, /role\|\|''\)\.toUpperCase\(\)==='DOCUMENTOS'/);
assert.match(runtime, /AMBIGUOUS_PHYSICAL_PRINTERS/);
assert.match(runtime, /NO_PHYSICAL_PRINTER/);
assert.match(runtime, /if\(state\.selected&&!confirm/);
assert.match(runtime, /operation:'WINDOWS_TEST'/);
assert.match(runtime, /¿Enviar una tirilla de prueba/);
assert.doesNotMatch(runtime, /api\('\/api\/v1\/impresion\/impresoras'.*\)\s*;?\s*button\(\)/s);
assert.match(routes, /restaurant-v2-cash-print-manager-v103\.js/);
assert.match(routes, /v103-read-safe/);

console.log('RESTAURANT CASH PRINT MANAGER V103 SMOKE OK');
