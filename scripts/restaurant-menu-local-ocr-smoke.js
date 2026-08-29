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

const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
assert.match(routes, /LOCAL_OCR/);
assert.match(routes, /analyzeWithAvailableProvider/);
assert.match(routes, /sin API key/);

const browser = fs.readFileSync('src/web/restaurant-menu-browser-ocr.js', 'utf8');
assert.match(browser, /VANTIX_BROWSER_OCR_V1/);
assert.match(browser, /tesseract\.js@5/);
assert.match(browser, /pdfjs-dist@3\.11\.174/);
assert.match(browser, /STATUS_PATH/);
assert.match(browser, /ANALYZE_PATH/);
assert.match(browser, /BROWSER_OCR/);
assert.doesNotMatch(browser, /OPENAI_API_KEY/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-menu-browser-ocr\.js/);
assert.match(publicRoutes, /browserFallback: true/);
assert.match(publicRoutes, /VANTIX_BROWSER_OCR_V1/);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts.build, 'npx prisma generate');

console.log(JSON.stringify({ ok:true, serverProvider:'LOCAL_OCR', browserProvider:'BROWSER_OCR', capabilities, parsedProducts:rows.length, apiKeyRequired:false, browserFallback:true }));
