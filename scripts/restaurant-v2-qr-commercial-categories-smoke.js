'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CATEGORY_MARKER,
  defaultCommercialCategory,
  decorateMenuCategories
} = require('../src/modules/restaurant/restaurant-v2-client-qr.public.routes');

assert.equal(CATEGORY_MARKER, 'VANTIX_RESTAURANT_V2_QR_COMMERCIAL_CATEGORIES_V1');
assert.equal(defaultCommercialCategory('ENTRADAS'), 'Entradas');
assert.equal(defaultCommercialCategory('FUERTES'), 'Fuertes');
assert.equal(defaultCommercialCategory('BEBIDAS'), 'Bebidas');
assert.equal(defaultCommercialCategory('POSTRES'), 'Postres');

const menu = [
  { id:'m-fuerte', category:'FUERTES', station:'COCINA', product:{ name:'Ranchera' } },
  { id:'m-bebida', category:'BEBIDAS', station:'BARRA', product:{ name:'Limonada' } },
  { id:'m-default', category:'POSTRES', station:'POSTRES', product:{ name:'Brownie' } }
];
const menuRows = [
  { id:'m-bebida', productId:'p-bebida', category:'BEBIDAS', sortOrder:1 },
  { id:'m-fuerte', productId:'p-fuerte', category:'FUERTES', sortOrder:2 },
  { id:'m-default', productId:'p-default', category:'POSTRES', sortOrder:3 }
];
const products = [
  { id:'p-fuerte', descripcion:'Categoría de carta: Hamburguesas' },
  { id:'p-bebida', descripcion:'Categoría de carta: Jugos naturales' },
  { id:'p-default', descripcion:'Brownie artesanal de la casa' }
];

const out = decorateMenuCategories(menu, menuRows, products);
assert.deepEqual(out.map((row) => row.id), ['m-bebida', 'm-fuerte', 'm-default']);
assert.deepEqual(out.map((row) => row.category), ['Jugos naturales', 'Hamburguesas', 'Postres']);
assert.deepEqual(out.map((row) => row.displayCategory), ['Jugos naturales', 'Hamburguesas', 'Postres']);
assert.deepEqual(out.map((row) => row.operationalCategory), ['BEBIDAS', 'FUERTES', 'POSTRES']);
assert.equal(out[0].station, 'BARRA');
assert.equal(out[1].station, 'COCINA');
assert.equal(out[2].station, 'POSTRES');

const source = fs.readFileSync(path.join(__dirname, '../src/modules/restaurant/restaurant-v2-client-qr.public.routes.js'), 'utf8');
assert.match(source, /\/api\/public\/restaurante\/qr\/:token/);
assert.match(source, /operationalCategory/);
assert.match(source, /publicCategoryFromDescription/);
assert.match(source, /X-VantixGC-Restaurant-QR-Categories/);

console.log('restaurant-v2-qr-commercial-categories-smoke: OK');
