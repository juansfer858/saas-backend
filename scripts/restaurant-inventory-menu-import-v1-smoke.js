'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const workspace = fs.readFileSync('src/web/restaurant-inventory-workspace-v1.js', 'utf8');
const loader = fs.readFileSync('src/web/restaurant-inventory-menu-import-loader-v1.js', 'utf8');
const commercial = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
const carta = fs.readFileSync('src/web/restaurant-v2-menu.js', 'utf8');
const menuUi = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
const menuRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const inventoryRoutes = fs.readFileSync('src/modules/inventory/inventory.routes.js', 'utf8');
const consumptionRoutes = fs.readFileSync('src/modules/consumption/consumption.routes.js', 'utf8');

// Los assets de la prueba anterior se conservan como rollback/histórico, pero no
// deben volver a ejecutarse dentro de Inventarios/Kardex.
assert.match(workspace, /VANTIX_RESTAURANT_INVENTORY_WORKSPACE_V1/);
assert.match(loader, /VANTIX_RESTAURANT_MENU_IMPORT_INVENTORY_V1/);
assert.doesNotThrow(() => new vm.Script(workspace));
assert.doesNotThrow(() => new vm.Script(loader));
assert.doesNotMatch(commercial, /restaurant-inventory-workspace-v1\.js/);
assert.doesNotMatch(commercial, /restaurant-inventory-menu-import-loader-v1\.js/);
assert.doesNotMatch(commercial, /X-VantixGC-Restaurant-Inventory-Workspace/);

// Carta es ahora la superficie canónica de Restaurante y reutiliza el OCR existente.
assert.match(carta, /VANTIX_RESTAURANT_V2_MENU_V1/);
assert.match(carta, /restaurant-menu-import-ui\.js/);
assert.match(carta, /\/api\/v1\/inventario\/productos/);
assert.match(carta, /\/api\/v1\/consumo\/recetas/);
assert.doesNotThrow(() => new vm.Script(carta));
assert.match(menuUi, /Importar carta \(foto\/PDF\)/);
assert.match(menuUi, /No se importan las fotos de la carta/);
assert.match(menuRoutes, /carta-importacion\/analizar-binario/);
assert.match(menuRoutes, /carta-importacion\/confirmar/);
assert.match(menuRoutes, /RESTAURANTE\.ADMINISTRAR/);
assert.match(inventoryRoutes, /router\.get\('\/productos'/);
assert.match(inventoryRoutes, /router\.get\('\/kardex'/);
assert.match(inventoryRoutes, /router\.post\('\/ajustes'/);
assert.match(consumptionRoutes, /router\.get\('\/recetas'/);
assert.match(consumptionRoutes, /router\.post\('\/recetas'/);

console.log('RESTAURANT INVENTORY SEPARATION GUARD OK', JSON.stringify({
  inventoryKeepsSuperCoreSurface: true,
  oldWorkspaceDormant: true,
  cartaOwnsMenuOcr: true,
  sharedInventoryAndRecipes: true
}));
