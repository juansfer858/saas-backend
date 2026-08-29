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

assert.equal(parser.productCandidate('ML SALCHIPAPAS TRADICIONAL -> salchicha queso papas'), 'SALCHIPAPAS TRADICIONAL');
assert.equal(parser.productCandidate('. TORNADO DE POLLO — pollo queso salsas'), 'TORNADO DE POLLO');
assert.equal(parser.familyCategory('SALCHIPAPAS AMERICANAS'), 'Salchipapas');
assert.equal(parser.familyCategory('PAPAS CHEDDAR'), 'Papas');
assert.equal(parser.familyCategory('COMBO TORNADOS'), 'Combos');

const realMenuRows = parser.parseMenuText(`
SALCHIPAPAS
ML SALCHIPAPAS TRADICIONAL -> salchicha queso papas 18.000
SALCHIPAPAS ESPECIALES con queso y salsas 21.000
SALCHIPAPAS AMERICANAS con tocineta 21.000
PAPAS
- PAPAS CHEDDAR con queso cheddar 20.000
TORNADOS
. TORNADO DE POLLO — pollo y queso 23.000
COMBOS
COMBO TORNADOS — dos tornados y bebida 30.000
CHUZOS
CHUZO DE POLLO con papas 24.000
`);
assert.deepEqual(realMenuRows.map((row) => [row.category, row.subcategory, row.price]), [
  ['Salchipapas', 'SALCHIPAPAS TRADICIONAL', 18000],
  ['Salchipapas', 'SALCHIPAPAS ESPECIALES', 21000],
  ['Salchipapas', 'SALCHIPAPAS AMERICANAS', 21000],
  ['Papas', 'PAPAS CHEDDAR', 20000],
  ['Tornados', 'TORNADO DE POLLO', 23000],
  ['Combos', 'COMBO TORNADOS', 30000],
  ['Chuzos', 'CHUZO DE POLLO', 24000]
]);
assert.ok(parser.menuOcrScore(`SALCHIPAPAS\nTRADICIONAL 18.000\nESPECIALES 21.000`) > parser.menuOcrScore('x = ; ~~ 123 abc'));

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
assert.match(browser, /VANTIX_BROWSER_OCR_MULTIPASS_V2/);
assert.match(browser, /tesseract\.js@5/);
assert.match(browser, /pdfjs-dist@3\.11\.174/);
assert.match(browser, /PSM_MODES\s*=\s*\['6', '11', '4'\]/);
assert.match(browser, /LANGUAGE_PROFILES/);
assert.match(browser, /tessedit_pageseg_mode/);
assert.match(browser, /user_defined_dpi:'220'/);
assert.match(browser, /menuOcrScore/);
assert.match(browser, /preserveOriginalImage:true/);
assert.match(browser, /STATUS_PATH/);
assert.match(browser, /ANALYZE_PATH/);
assert.match(browser, /BROWSER_OCR/);
assert.doesNotMatch(browser, /OPENAI_API_KEY/);

const ui = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
assert.match(ui, /status\.preserveOriginalImage/);
assert.match(ui, /3600/);
assert.match(ui, /\.94/);
assert.match(ui, /comparando varias lecturas/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-menu-browser-ocr\.js/);
assert.match(publicRoutes, /browserFallback: true/);
assert.match(publicRoutes, /VANTIX_BROWSER_OCR_V1/);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts.build, 'npx prisma generate');

console.log(JSON.stringify({ ok:true, serverProvider:'LOCAL_OCR', browserProvider:'BROWSER_OCR', quality:'MULTIPASS_V2', capabilities, parsedProducts:rows.length, realisticProducts:realMenuRows.length, apiKeyRequired:false, browserFallback:true }));
