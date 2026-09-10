'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ui = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
const linkService = fs.readFileSync('src/modules/restaurant/restaurant-menu-import-link.service.js', 'utf8');
const publicRoutes = require('../src/modules/restaurant/restaurant-menu-import.public.routes');

assert.match(ui, /VANTIX_MENU_OCR_MANUAL_INVENTORY_LINK_V1/);
assert.match(ui, /existingProductId/);
assert.match(ui, /Preparado \(por defecto\)/);
assert.match(ui, /Las sugerencias nunca se vinculan solas/);
assert.match(ui, /controlaInventario === true/);
assert.match(ui, /!recipeOutputs\.has\(product\.id\)/);
assert.match(ui, /loadDirectInventoryProducts/);
assert.match(ui, /candidateScore/);
assert.match(ui, /preventDuplicateManualLinks/);
assert.doesNotMatch(ui, /existingProductId[^\n]+selected/);
assert.doesNotThrow(() => new vm.Script(ui));

assert.match(routes, /restaurant-menu-import-link\.service/);
assert.match(routes, /existingProductId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)\.nullable\(\)/);
assert.match(routes, /confirmImportLinked/);
assert.doesNotThrow(() => new vm.Script(routes));

assert.match(linkService, /RESTAURANT_MENU_IMPORT_DUPLICATE_INVENTORY_LINK/);
assert.match(linkService, /RESTAURANT_MENU_IMPORT_INVENTORY_PRODUCT_INVALID/);
assert.match(linkService, /RESTAURANT_MENU_IMPORT_INVENTORY_PRODUCT_HAS_ACTIVE_RECIPE/);
assert.match(linkService, /controlaInventario:\s*true/);
assert.match(linkService, /precio1:\s*item\.price/);
assert.doesNotMatch(linkService, /stockActual:\s*item/);
assert.doesNotMatch(linkService, /costoPromedio:\s*item/);
assert.match(linkService, /manualInventoryLinks:\s*true/);
assert.doesNotThrow(() => new vm.Script(linkService));

const asset = publicRoutes.buildMenuImportBrowserAsset();
assert.match(asset, /VANTIX_MENU_OCR_END_TO_END_10MB_V7/);
assert.match(asset, /VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8/);
assert.match(asset, /VANTIX_MENU_OCR_MANUAL_INVENTORY_LINK_V1/);
assert.match(asset, /existingProductId/);
assert.doesNotMatch(asset, /MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);

console.log('RESTAURANT V2 CARTA OCR LINK V1 SMOKE OK', JSON.stringify({
  defaultPrepared: true,
  manualLinkOnly: true,
  directInventoryCandidatesOnly: true,
  activeRecipeCandidatesExcluded: true,
  canonical10MbOcrPreserved: true
}));
