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

const qrBase = read('src/web/restaurant-qr-ui.js');
const qr = patchQrSource(qrBase);
assert.ok(qr.includes(MARKER));
assert.ok(qr.includes('Buscar en toda la carta…'));
assert.ok(qr.includes('globalMenuSearchTokens(S.search)'));
assert.ok(qr.includes("tokens.every((token) => globalMenuHaystack(item).includes(token))"));
assert.ok(qr.includes("S.search = '';"));
assert.ok(qr.includes('Buscando en toda la carta, sin importar categoría.'));
assert.ok(!qr.includes("const S = { ctx:null, cart:new Map(), filter:'FEATURED', sending:false };"));

// Simula el asset que V57 recibe después de Menu Surfaces V10.
const qrComposedInput = qrBase
  .replace("return rows.filter((item) => item.category === S.filter);", "return rows.filter((item) => menuDisplayCategory(item) === S.filter);")
  .replace("const filter = FILTERS.find((row) => row.id === S.filter);", "const filter = categoryFilters().find((row) => row.id === S.filter);");
const qrComposed = patchQrSource(qrComposedInput);
assert.ok(qrComposed.includes(MARKER));
assert.ok(qrComposed.includes("typeof menuDisplayCategory === 'function'"));

const operatorBase = read('src/web/restaurant-ui.js');
const operator = patchOperatorSource(operatorBase);
assert.ok(operator.includes(MARKER));
assert.ok(operator.includes('id="waiterGlobalSearch"'));
assert.ok(operator.includes('id="waiterGlobalSearchClear"'));
assert.ok(operator.includes('if (searchTokens.length) return globalMenuSearchMatches(item, searchTokens);'));
assert.ok(operator.includes("S.waiterCategory=button.dataset.waiterCategory; S.waiterSearch='';"));
assert.ok(operator.includes("event.key === 'Enter'"));
assert.ok(!operator.includes("item.category === category && (!search ||"));

const operatorComposedInput = operatorBase.replace(
  "    const search = String(S.waiterSearch || '').trim().toLocaleLowerCase('es');\n    const category = S.waiterCategory || 'ENTRADAS';\n    const visibleMenu = S.menu.filter((item) => item.category === category && (!search || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(search)));",
  "    const search = String(S.waiterSearch || '').trim().toLocaleLowerCase('es');\n    const menuCategories = waiterMenuCategories();\n    if (!S.waiterCategory || !menuCategories.includes(S.waiterCategory)) S.waiterCategory = menuCategories[0] || null;\n    const category = S.waiterCategory || '';\n    const visibleMenu = S.menu.filter((item) => waiterDisplayCategory(item) === category && (!search || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(search)));"
);
const operatorComposed = patchOperatorSource(operatorComposedInput);
assert.ok(operatorComposed.includes(MARKER));
assert.ok(operatorComposed.includes("typeof waiterMenuCategories === 'function'"));
assert.ok(operatorComposed.includes('globalMenuSearchMatches(item, searchTokens)'));

const waiterBase = read('src/web/restaurant-waiter-runtime-v7.js');
const waiter = patchDedicatedWaiterSource(waiterBase);
assert.ok(waiter.includes(MARKER));
assert.ok(waiter.includes('placeholder="Buscar en toda la carta…"'));
assert.ok(waiter.includes('if (tokens.length) return globalMenuSearchMatches(item, tokens);'));
assert.ok(waiter.includes("' · toda la carta'"));
assert.ok(waiter.includes("S.search = '';"));
assert.ok(!waiter.includes("item.category === S.category && (!needle ||"));

const waiterComposedInput = waiterBase.replace(
  "return S.menu.filter((item) => item.category === S.category && (!needle || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(needle)));",
  "return S.menu.filter((item) => menuDisplayCategory(item) === S.category && (!needle || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(needle)));"
);
const waiterComposed = patchDedicatedWaiterSource(waiterComposedInput);
assert.ok(waiterComposed.includes(MARKER));
assert.ok(waiterComposed.includes("typeof menuDisplayCategory === 'function'"));
assert.ok(waiterComposed.includes('globalMenuSearchMatches(item, tokens)'));

const routes = read('src/modules/restaurant/restaurant.public.routes.js');
const v57Use = routes.indexOf('router.use(installRestaurantGlobalProductSearchV57);');
const v56Use = routes.indexOf('router.use(installRestaurantTableEnableV56);');
assert.ok(v57Use >= 0 && v56Use >= 0 && v57Use < v56Use, 'V57 debe envolver V56 para recibir el asset final');

// Contrato funcional: acentos, mayúsculas y categoría no limitan una búsqueda activa.
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

console.log('RESTAURANT GLOBAL PRODUCT SEARCH V57 ALL-MENU + COMPOSITION CONTRACT OK');
