'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MARKER,
  patchQrSource,
  patchOperatorSource,
  patchDedicatedWaiterSource
} = require('../src/modules/restaurant/restaurant-global-product-search-v57.public.routes');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const qr = patchQrSource(read('src/web/restaurant-qr-ui.js'));
assert.ok(qr.includes(MARKER));
assert.ok(qr.includes('Buscar en toda la carta…'));
assert.ok(qr.includes('globalMenuSearchTokens(S.search)'));
assert.ok(qr.includes("tokens.every((token) => globalMenuHaystack(item).includes(token))"));
assert.ok(qr.includes("S.search = '';"));
assert.ok(qr.includes('Buscando en toda la carta, sin importar categoría.'));
assert.ok(!qr.includes("const S = { ctx:null, cart:new Map(), filter:'FEATURED', sending:false };"));

const operator = patchOperatorSource(read('src/web/restaurant-ui.js'));
assert.ok(operator.includes(MARKER));
assert.ok(operator.includes('id="waiterGlobalSearch"'));
assert.ok(operator.includes('id="waiterGlobalSearchClear"'));
assert.ok(operator.includes('searchTokens.length ? globalMenuSearchMatches(item, searchTokens) : item.category === category'));
assert.ok(operator.includes("S.waiterCategory=button.dataset.waiterCategory; S.waiterSearch='';"));
assert.ok(operator.includes("event.key === 'Enter'"));
assert.ok(!operator.includes("item.category === category && (!search ||"));

const waiter = patchDedicatedWaiterSource(read('src/web/restaurant-waiter-runtime-v7.js'));
assert.ok(waiter.includes(MARKER));
assert.ok(waiter.includes('placeholder="Buscar en toda la carta…"'));
assert.ok(waiter.includes('tokens.length ? globalMenuSearchMatches(item, tokens) : item.category === S.category'));
assert.ok(waiter.includes("' · toda la carta'"));
assert.ok(waiter.includes("S.search = '';"));
assert.ok(!waiter.includes("item.category === S.category && (!needle ||"));

const routes = read('src/modules/restaurant/restaurant.public.routes.js');
const v57Use = routes.indexOf('router.use(installRestaurantGlobalProductSearchV57);');
const v56Use = routes.indexOf('router.use(installRestaurantTableEnableV56);');
assert.ok(v57Use >= 0 && v56Use >= 0 && v57Use < v56Use, 'V57 debe envolver V56 para recibir el asset final');

// Contrato funcional del buscador: acentos y categoría no limitan una búsqueda activa.
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
const tokens = (value) => normalize(value).split(/\s+/).filter(Boolean);
const matches = (item, query) => {
  const haystack = normalize([item.product?.nombre, item.category, item.station].filter(Boolean).join(' '));
  return tokens(query).every((token) => haystack.includes(token));
};
const sample = [
  { category:'BEBIDAS', station:'BARRA', product:{ nombre:'Café americano' } },
  { category:'POSTRES', station:'POSTRES', product:{ nombre:'Torta de café' } },
  { category:'FUERTES', station:'COCINA', product:{ nombre:'Carne asada' } }
];
assert.deepEqual(sample.filter((item) => matches(item, 'cafe')).map((item) => item.product.nombre), ['Café americano', 'Torta de café']);
assert.deepEqual(sample.filter((item) => matches(item, 'CAFE')).map((item) => item.product.nombre), ['Café americano', 'Torta de café']);

console.log('RESTAURANT GLOBAL PRODUCT SEARCH V57 ALL-MENU CONTRACT OK');
