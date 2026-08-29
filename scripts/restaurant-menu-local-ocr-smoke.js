'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const parser = require('../src/modules/restaurant/restaurant-menu-local-parser');
const localOcr = require('../src/modules/restaurant/restaurant-menu-local-ocr.service');

assert.equal(parser.parsePriceToken('$25.000'), 25000);
assert.equal(parser.parsePriceToken('22K'), 22000);
assert.equal(parser.parsePriceToken('9.500 COP'), 9500);

const rows = parser.parseMenuText(`
HAMBURGUESAS
Ranchera ........ $25.000
Clasica 22K
BEBIDAS
Limonada natural 9.000
POSTRES
Brownie
12.000
`);

assert.equal(rows.length, 4);
assert.deepEqual(rows.map((row) => [row.category, row.subcategory, row.price]), [
  ['Hamburguesas', 'Ranchera', 25000],
  ['Hamburguesas', 'Clasica', 22000],
  ['Bebidas', 'Limonada natural', 9000],
  ['Postres', 'Brownie', 12000]
]);
assert.equal(rows[2].operationalCategory, 'BEBIDAS');
assert.equal(rows[2].station, 'BARRA');
assert.equal(rows[3].operationalCategory, 'POSTRES');
assert.equal(rows[3].station, 'POSTRES');

const capabilities = localOcr.runtimeCapabilities(true);
for (const key of ['tesseract', 'pdftotext', 'pdftoppm']) assert.equal(capabilities[key], true, `${key} debe estar instalado en CI`);
const status = localOcr.providerStatus(5 * 1024 * 1024);
assert.equal(status.configured, true);
assert.equal(status.provider, 'LOCAL_OCR');
assert.equal(status.capabilities.imageOcr, true);
assert.equal(status.capabilities.pdfText, true);
assert.equal(status.capabilities.pdfScan, true);

const nixpacks = fs.readFileSync('nixpacks.toml', 'utf8');
for (const pkg of ['tesseract-ocr', 'tesseract-ocr-spa', 'poppler-utils']) assert.match(nixpacks, new RegExp(pkg));
const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
assert.match(routes, /LOCAL_OCR/);
assert.match(routes, /analyzeWithAvailableProvider/);
assert.match(routes, /sin API key/);
const buildBootstrap = fs.readFileSync('scripts/prepare-restaurant-ocr-runtime.js', 'utf8');
for (const marker of ['tesseract-ocr-spa', 'poppler-utils', 'RESTAURANT_LOCAL_OCR_RUNTIME_INSTALLED']) assert.match(buildBootstrap, new RegExp(marker));
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(packageJson.scripts.build, /prepare-restaurant-ocr-runtime\.js/);
assert.match(packageJson.scripts.build, /prisma generate/);

console.log(JSON.stringify({ ok:true, provider:'LOCAL_OCR', capabilities, parsedProducts:rows.length, apiKeyRequired:false, buildBootstrap:true }));
