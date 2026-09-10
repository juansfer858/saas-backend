'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const html = read('src/web/restaurant-v2-menu.html');
const selector = read('src/web/restaurant-v2-menu-category-selector-v14.js');
const menu = read('src/web/restaurant-v2-menu.js');
const routes = read('src/modules/restaurant/restaurant-v2-menu.public.routes.js');

assert(html.includes('<select id="preparedCommercialCategory"'), 'Nuevo plato debe usar select para Categoría visible');
assert(!html.includes('<input id="preparedCommercialCategory"'), 'Categoría visible no debe seguir como texto libre en Nuevo plato');
assert(html.includes('restaurant-v2-menu-category-selector-v14.js?v=v14'), 'Carta debe cargar selector V14');
assert(selector.includes('VANTIX_RESTAURANT_V2_MENU_VISIBLE_CATEGORY_SELECTOR_V14'), 'Falta marcador V14');
assert(selector.includes("/api/v1/restaurante/carta-importacion/lista"), 'V14 debe leer categorías desde la Carta canónica');
assert(selector.includes("['Entradas', 'Fuertes', 'Bebidas', 'Postres']"), 'V14 debe conservar categorías base como fallback');
assert(selector.includes("target.dataset.categorySource = source"), 'V14 debe distinguir Carta vs fallback');
assert(menu.includes("$('#preparedCommercialCategory').value.trim()"), 'El guardado debe seguir tomando la categoría visible seleccionada');
assert(routes.includes("/app/restaurant-v2-menu-category-selector-v14.js"), 'Falta publicar asset V14');

console.log('Restaurant V2 Menu Visible Category V14 smoke: OK');
