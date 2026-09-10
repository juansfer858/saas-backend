'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const route = fs.readFileSync('src/modules/restaurant/restaurant-v2-menu.public.routes.js', 'utf8');
const aggregator = fs.readFileSync('src/modules/restaurant/restaurant-operational-v2-preview.public.routes.js', 'utf8');
const shell = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js', 'utf8');
const html = fs.readFileSync('src/web/restaurant-v2-menu.html', 'utf8');
const js = fs.readFileSync('src/web/restaurant-v2-menu.js', 'utf8');
const css = fs.readFileSync('src/web/restaurant-v2-menu.css', 'utf8');
const commercial = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
const salesService = fs.readFileSync('src/modules/commercial/sales.service.js', 'utf8');
const menuRoutes = fs.readFileSync('src/modules/restaurant/restaurant.routes.js', 'utf8');
const importService = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.service.js', 'utf8');
const inventoryRoutes = fs.readFileSync('src/modules/inventory/inventory.routes.js', 'utf8');
const consumptionRoutes = fs.readFileSync('src/modules/consumption/consumption.routes.js', 'utf8');
const consumptionService = fs.readFileSync('src/modules/consumption/consumption.service.js', 'utf8');

assert.match(route, /restaurantV2MenuPublicRouter/);
assert.match(route, /\/app\/restaurante-v2\/carta/);
assert.match(route, /restaurant-v2-menu\.html/);
assert.match(aggregator, /restaurantV2MenuPublicRouter/);
assert.match(aggregator, /use\(restaurantV2MenuPublicRouter\)/);

assert.match(shell, /carta:\{ label:'Carta'/);
assert.match(shell, /route:'\/app\/restaurante-v2\/carta'/);
assert.match(shell, /inventario:\{ label:'Inventario \/ Kardex'/);
assert.match(shell, /route:'\/app\/inventario'/);
assert.doesNotMatch(shell, /label:'Carta \/ inventario'/);

assert.match(html, /id="ccCustomView"/);
assert.match(html, /Carta y productos/);
assert.match(html, /\+ Nuevo plato/);
assert.match(html, /\+ Desde inventario/);
assert.match(html, /Inventario \/ Kardex/);
assert.match(html, /id="configureRecipe"/);
assert.match(html, /id="menuGrid" class="menu-grid"/);
// El OCR canónico puede reutilizar el encabezado y sus acciones, pero no debe encontrar
// un grid legado dentro de Carta V2: de lo contrario repinta la carta antigua como una
// tercera columna del encabezado y desplaza todo el layout hacia la derecha.
assert.doesNotMatch(html, /class="cc-menu-grid"/);

assert.match(js, /VANTIX_RESTAURANT_V2_MENU_V1/);
assert.match(js, /VANTIX_RESTAURANT_V2_MENU_RECIPE_MODE_V2/);
assert.match(js, /\/api\/v1\/restaurante\/menu\?active=true/);
assert.match(js, /\/api\/v1\/inventario\/productos\?activo=true&limit=1000/);
assert.match(js, /\/api\/v1\/consumo\/recetas\?limit=1000/);
assert.match(js, /requiresRecipe:\s*false/);
assert.match(js, /controlaInventario:\s*false/);
assert.match(js, /kind === 'DIRECT'/);
assert.match(js, /kind === 'RECIPE'/);
assert.match(js, /function setRecipeActive/);
assert.match(js, /active:Boolean\(active\)/);
assert.match(js, /mode !== 'RECIPE'\) await setRecipeActive\(recipe, false\)/);
assert.match(js, /mode === 'RECIPE'\) await setRecipeActive\(recipe, true\)/);
assert.match(js, /recipeModeExclusive:true/);
assert.match(js, /recipePreservedWhenDisabled:true/);
assert.match(js, /restaurant-menu-import-ui\.js/);
assert.match(js, /canonicalOcrReused:true/);
assert.doesNotThrow(() => new vm.Script(js));
assert.match(css, /VANTIX_RESTAURANT_V2_MENU_CSS_V1/);

// Inventario/Kardex vuelve a ser una superficie administrativa pura: Carta no se
// inyecta dentro de su runtime. Los archivos históricos pueden permanecer dormidos
// como rollback técnico, pero no forman parte de la respuesta ejecutable actual.
assert.doesNotMatch(commercial, /restaurant-inventory-workspace-v1\.js/);
assert.doesNotMatch(commercial, /restaurant-inventory-menu-import-loader-v1\.js/);
assert.doesNotMatch(commercial, /X-VantixGC-Restaurant-Inventory-Workspace/);

// Reutilizamos contratos existentes, no un segundo inventario ni una segunda receta.
assert.match(menuRoutes, /router\.get\('\/menu'/);
assert.match(menuRoutes, /router\.post\('\/menu'/);
assert.match(menuRoutes, /router\.put\('\/menu\/:id'/);
assert.match(inventoryRoutes, /router\.post\('\/productos'/);
assert.match(inventoryRoutes, /router\.get\('\/kardex'/);
assert.match(consumptionRoutes, /router\.post\('\/recetas'/);

// Contrato real al emitir la venta: una receta activa consume sus insumos; si no
// hay receta activa y el producto controla inventario, se descuenta ese mismo SKU.
assert.match(salesService, /consumption\.consumeForSaleInTx/);
assert.match(salesService, /if \(recipeConsumption\.recipeOutputProductIds\.has\(product\.id\)\) continue/);
assert.match(salesService, /inventory\.applyMovement\(tx, \{/);
assert.match(salesService, /tipo:\s*'VENTA'/);
assert.match(consumptionService, /active:\s*true, outputProductId:\s*\{ in: productIds \}/);
assert.match(consumptionService, /recipeOutputProductIds/);
assert.match(consumptionService, /ingredientProductId/);

// El OCR ya crea platos vendibles sin exigir receta: regla de adopción simple.
assert.match(importService, /requiresRecipe:\s*false/);
assert.match(importService, /controlaInventario:\s*false/);

console.log('RESTAURANT V2 MENU V1 SMOKE OK', JSON.stringify({
  standaloneCarta: true,
  inventorySeparated: true,
  masterProductReused: true,
  directInventorySupported: true,
  optionalRecipeSupported: true,
  recipeModeExclusive: true,
  recipesPreservedWhenDisabled: true,
  salesEngineDirectOrRecipeVerified: true,
  canonicalOcrReused: true,
  legacyOcrGridExcludedFromV2Layout: true
}));
