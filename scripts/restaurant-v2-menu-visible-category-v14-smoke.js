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
const routes = read('src/modules/restaurant/restaurant-menu-import.routes.js');
const service = read('src/modules/restaurant/restaurant-commercial-categories-v26.service.js');
const schema = read('prisma/restaurant-commercial-categories-v26.prisma');
const restaurantSchema = read('prisma/restaurant-phase2-v1.prisma');

for (const id of ['preparedCommercialCategory', 'inventoryCommercialCategory', 'editCommercialCategory']) {
  assert(html.includes(`<select id="${id}"`), `${id} debe usar catálogo central de categorías`);
  assert(!html.includes(`<input id="${id}"`), `${id} no debe seguir como texto libre`);
}
assert(html.includes('id="manageCategories"'), 'Carta debe ofrecer administración de categorías');
assert(html.includes('id="commercialCategoryDialog"'), 'Falta diálogo de categorías');
assert(html.includes('restaurant-v2-menu-category-selector-v14.js?v=v26'), 'Carta debe cargar runtime V26');
assert(selector.includes('VANTIX_RESTAURANT_COMMERCIAL_CATEGORIES_V26'), 'Falta marcador V26');
assert(selector.includes('/api/v1/restaurante/carta-importacion/categorias?includeInactive=true'), 'V26 debe leer catálogo central');
assert(selector.includes("method:'POST'"), 'V26 debe permitir crear categorías');
assert(selector.includes("method:'PATCH'"), 'V26 debe permitir modificar categorías');
assert(selector.includes('/categoria`'), 'V26 debe persistir asignación de producto');
assert(menu.includes("$('#preparedCommercialCategory').value.trim()"), 'El flujo existente de Nuevo plato debe conservar el nombre visible seleccionado');
assert(routes.includes("/carta-importacion/categorias"), 'Faltan endpoints de categorías');
assert(routes.includes("/carta-importacion/items/:id/categoria"), 'Falta endpoint de asignación comercial');
assert(service.includes('RestaurantCommercialCategory') || service.includes('restaurantCommercialCategory'), 'Falta servicio de catálogo comercial');
assert(schema.includes('model RestaurantCommercialCategory'), 'Falta modelo de categorías comerciales');
assert(restaurantSchema.includes('commercialCategoryId String?'), 'RestaurantMenuItem debe conservar referencia comercial separada');
assert(restaurantSchema.includes('category             RestaurantMenuCategory'), 'La categoría operativa no debe eliminarse');
assert(restaurantSchema.includes('station              RestaurantStation'), 'La estación operativa no debe eliminarse');

console.log('Restaurant V2 Commercial Categories V26 smoke: OK');
