'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/web/restaurant-production-kds-v63.html'), 'utf8');

assert.match(source, /VANTIX_RESTAURANT_PRODUCTION_KDS_V64/);
assert.match(source, /\.product-name\{font-size:18px;/);
assert.match(source, /<span class="product-name">\$\{esc\(item\.description\|\|'Producto'\)\}<\/span>/);
assert.match(source, /<small>\$\{esc\(ageLabel\(command\)\)\}<\/small>/);
assert.doesNotMatch(source, /command\.waiter\?\.nombre/);
assert.doesNotMatch(source, /'Cliente · QR'/);

// El cambio V64 es sólo visual: las acciones y el circuito KDS deben seguir intactos.
assert.match(source, /data-state="EN_PREPARACION">TOMAR/);
assert.match(source, /data-state="LISTA">✓ MARCAR LISTO/);
assert.match(source, /data-state="ENTREGADA">MARCAR ENTREGADO/);
assert.match(source, /\/api\/v1\/restaurante\/comandas\?limit=200/);
assert.match(source, /method:'PATCH'/);
assert.match(source, /productionTabletV63=MARKER/);

console.log('RESTAURANT PRODUCTION KDS V64 OK', JSON.stringify({
  operatorHidden: true,
  productNamePx: 18,
  kdsActionsPreserved: true
}));
