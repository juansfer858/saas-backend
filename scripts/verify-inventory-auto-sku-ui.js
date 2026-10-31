'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const inventory = fs.readFileSync('src/web/inventory-product-create-v70.js','utf8');
const menu = fs.readFileSync('src/web/restaurant-v2-menu.js','utf8');
const menuHtml = fs.readFileSync('src/web/restaurant-v2-menu.html','utf8');
const routes = fs.readFileSync('src/modules/inventory/inventory.routes.js','utf8');
const service = fs.readFileSync('src/modules/inventory/inventory.service.js','utf8');

assert(inventory.includes('Código automático'));
assert(inventory.includes('readonly aria-readonly="true"'));
assert(inventory.includes('/api/v1/inventario/productos/siguiente-sku'));
assert(!inventory.includes("sku:document.querySelector('#invProductSku').value.trim()"));

assert(menuHtml.includes('Código automático'));
assert(menuHtml.includes('readonly aria-readonly="true"'));
assert(menuHtml.includes('restaurant-v2-menu.js?v=v28-auto-sku'));
assert(menu.includes('/api/v1/inventario/productos/siguiente-sku'));
assert(!menu.includes('function generateSku('));
assert(!menu.includes("sku: $('#preparedSku').value.trim()"));

assert(routes.indexOf("router.get('/productos/siguiente-sku'") < routes.indexOf("router.get('/productos/:id'"));
assert(service.includes('for (let attempt = 0; attempt < 12; attempt += 1)'));
assert(service.includes('PRODUCT_AUTO_SKU_RETRY_EXHAUSTED'));

console.log('INVENTORY_AUTO_SKU_UI_OK inventory_readonly carta_readonly backend_authoritative cache_busted');
