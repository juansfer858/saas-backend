'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const workspace = fs.readFileSync('src/web/restaurant-inventory-workspace-v1.js', 'utf8');
const loader = fs.readFileSync('src/web/restaurant-inventory-menu-import-loader-v1.js', 'utf8');
const commercial = fs.readFileSync('src/modules/commercial/commercial.routes.js', 'utf8');
const menuUi = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
const menuRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const inventoryRoutes = fs.readFileSync('src/modules/inventory/inventory.routes.js', 'utf8');
const consumptionRoutes = fs.readFileSync('src/modules/consumption/consumption.routes.js', 'utf8');

assert.match(workspace, /VANTIX_RESTAURANT_INVENTORY_WORKSPACE_V1/);
assert.match(workspace, /Inventarios \/ Kardex/);
for (const tab of ['Productos', 'Insumos', 'Recetas', 'Kardex']) assert.match(workspace, new RegExp(`>${tab}<`));
assert.match(workspace, /inventoryAddProductButton/);
assert.match(workspace, /Importar carta/);
assert.match(workspace, /openInventoryAdjustment/);
assert.match(workspace, /\/api\/v1\/inventario\/productos\?limit=500/);
assert.match(workspace, /\/api\/v1\/inventario\/kardex\?limit=500/);
assert.match(workspace, /\/api\/v1\/consumo\/recetas\?limit=500/);
assert.match(workspace, /\/api\/v1\/restaurante\/carta-importacion\/lista/);
assert.match(workspace, /method:\s*'POST'/);
assert.match(workspace, /outputProductId/);
assert.match(workspace, /ingredientProductId/);
assert.doesNotThrow(() => new vm.Script(workspace));

assert.match(loader, /VANTIX_RESTAURANT_MENU_IMPORT_INVENTORY_V1/);
assert.match(loader, /\/app\/restaurant-menu-import-ui\.js/);
assert.match(loader, /LEGACY_GUARD/);
assert.match(loader, /INVENTORY_GUARD/);
assert.match(loader, /reusesCanonicalOcrAsset:\s*true/);
assert.match(loader, /VantixGCRestaurantInventoryWorkspaceV1\?\.refresh/);
assert.doesNotThrow(() => new vm.Script(loader));

assert.match(commercial, /restaurant-inventory-workspace-v1\.js/);
assert.match(commercial, /restaurant-inventory-menu-import-loader-v1\.js/);
assert.match(commercial, /X-VantixGC-Restaurant-Inventory-Workspace/);
assert.match(commercial, /X-VantixGC-Restaurant-Menu-Import-Inventory/);
assert.match(commercial, /VANTIX_RESTAURANT_INVENTORY_WORKSPACE_V1/);
assert.match(commercial, /VANTIX_RESTAURANT_MENU_IMPORT_INVENTORY_V1/);
assert.doesNotThrow(() => new vm.Script(commercial));

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

console.log('RESTAURANT INVENTORY + MENU IMPORT V1 SMOKE OK', JSON.stringify({
  workspace: true,
  tabs: ['Productos', 'Insumos', 'Recetas', 'Kardex'],
  canonicalMenuOcrReused: true,
  recipeInventorySeparated: true
}));
