'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'restaurant-control-center.js'), 'utf8');
const actionBlock = js.match(/<div class=\"cc-actions\">([\s\S]*?)<\/div><\/section>/)?.[1] || '';

assert.ok(actionBlock, 'No se encontró la cuadrícula principal del Centro de control');
assert.doesNotMatch(actionBlock, /Estado \/ tema/, 'Tema / Estado no debe aparecer como acción principal');
assert.match(actionBlock, /data-cc-tab=\"mesero\">[^<]*Mesero<\/button>/, 'Mesero debe ocupar la acción principal liberada');
assert.match(actionBlock, /Nuevo pedido/, 'Nuevo pedido debe permanecer disponible');
assert.match(actionBlock, /Pedidos en curso/);
assert.match(actionBlock, /Carta y productos/);

console.log(JSON.stringify({ ok: true, centerAction: 'Mesero', themeRemovedFromPrimaryGrid: true }));
