'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const parser = require('../src/modules/restaurant/restaurant-menu-local-parser');
const localOcr = require('../src/modules/restaurant/restaurant-menu-local-ocr.service');
const layout = require('../src/web/restaurant-menu-layout-parser-v3.js');

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
  ['Hamburguesas','Ranchera',25000],['Hamburguesas','Clasica',22000],['Bebidas','Limonada natural',9000],['Postres','Brownie',12000]
]);
assert.equal(rows[2].operationalCategory, 'BEBIDAS');
assert.equal(rows[2].station, 'BARRA');
assert.equal(rows[3].operationalCategory, 'POSTRES');
assert.equal(rows[3].station, 'POSTRES');

assert.equal(parser.productCandidate('ML SALCHIPAPAS TRADICIONAL -> salchicha queso papas'), 'SALCHIPAPAS TRADICIONAL');
assert.equal(parser.productCandidate('. TORNADO DE POLLO — pollo queso salsas'), 'TORNADO DE POLLO');
assert.equal(parser.productCandidate('f- COMBO TORNADOS — dos tornados y bebida'), 'COMBO TORNADOS');
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
f- COMBO TORNADOS — dos tornados y bebida 30.000
CHUZOS
CHUZO DE POLLO con papas 24.000
`);
assert.deepEqual(realMenuRows.map((row) => [row.category, row.subcategory, row.price]), [
  ['Salchipapas','SALCHIPAPAS TRADICIONAL',18000],
  ['Salchipapas','SALCHIPAPAS ESPECIALES',21000],
  ['Salchipapas','SALCHIPAPAS AMERICANAS',21000],
  ['Papas','PAPAS CHEDDAR',20000],
  ['Tornados','TORNADO DE POLLO',23000],
  ['Combos','COMBO TORNADOS',30000],
  ['Chuzos','CHUZO DE POLLO',24000]
]);
assert.ok(parser.menuOcrScore(`SALCHIPAPAS\nTRADICIONAL 18.000\nESPECIALES 21.000`) > parser.menuOcrScore('x = ; ~~ 123 abc'));

const word = (text, x0, y0, x1, y1, confidence = 92) => ({ text, confidence, bbox:{ x0,y0,x1,y1 } });
const line = (words) => ({ words, text:words.map((w)=>w.text).join(' '), confidence:90, bbox:{ x0:Math.min(...words.map((w)=>w.bbox.x0)), y0:Math.min(...words.map((w)=>w.bbox.y0)), x1:Math.max(...words.map((w)=>w.bbox.x1)), y1:Math.max(...words.map((w)=>w.bbox.y1)) } });
const block = (lines) => ({ paragraphs:[{ lines }] });

const denseBlocks = [block([
  line([
    word('SALCHIPAPAS',45,20,150,38), word('TRADICIONAL',155,20,260,38),
    word('Papas,',265,26,300,34), word('salchichas,',304,26,360,34), word('$',400,20,410,38), word('18.000',414,20,463,38)
  ]),
  line([
    word('TORNADO',45,55,120,73), word('DE',124,55,146,73), word('POLLO',150,55,205,73),
    word('tocineta,',210,61,255,69), word('$',300,55,310,73), word('23.000',314,55,363,73),
    word('GRATINADO',370,55,446,73), word('$',450,55,460,73), word('26.000',464,55,513,73)
  ]),
  line([
    word('JUGOS',45,90,95,108), word('Mora,',100,96,128,104), word('mango,',132,96,165,104),
    word('$',200,90,210,108), word('8.000',214,90,252,108), word('AGUA',310,90,355,108), word('$',400,90,410,108), word('5.500',414,90,452,108)
  ]),
  line([word('COMBO',40,130,88,148), word('1',92,130,101,148), word('COMBO',180,130,228,148), word('2',232,130,241,148)]),
  line([word('30.000',55,160,105,178), word('31.000',195,160,245,178)]),
  line([word('FOOD',50,215,95,233), word('HOUSE',100,215,155,233), word('Pan',160,221,182,229), word('queso',186,221,220,229), word('$',400,215,410,233), word('14.000',414,215,463,233)])
])];

const anchors = [{ y:25, category:'Especial House' }, { y:220, category:'Sándwiches' }];
const layoutRows = layout.parseBlocks(denseBlocks, 520, 300, anchors);
const compact = layoutRows.map((row) => [row.category, row.subcategory, row.price]);
assert.ok(compact.some((row) => row[0] === 'Salchipapas' && row[1] === 'SALCHIPAPAS TRADICIONAL' && row[2] === 18000));
assert.ok(compact.some((row) => row[0] === 'Tornados' && row[1] === 'TORNADO DE POLLO' && row[2] === 23000));
assert.ok(compact.some((row) => row[1] === 'TORNADO DE POLLO GRATINADO' && row[2] === 26000));
assert.ok(compact.some((row) => row[0] === 'Bebidas' && row[1] === 'JUGOS' && row[2] === 8000));
assert.ok(compact.some((row) => row[0] === 'Bebidas' && row[1] === 'AGUA' && row[2] === 5500));
assert.ok(compact.some((row) => row[0] === 'Combos' && row[1] === 'COMBO 1' && row[2] === 30000));
assert.ok(compact.some((row) => row[0] === 'Combos' && row[1] === 'COMBO 2' && row[2] === 31000));
assert.ok(compact.some((row) => row[0] === 'Sándwiches' && row[1] === 'FOOD HOUSE' && row[2] === 14000));

const rotatedBlocks = [block([
  line([word('HAMBURGUESAS',500,5,620,22)]),
  line([word('SANDWICHES',180,5,280,22)])
])];
const detectedAnchors = layout.detectCategoryAnchorsFromRotatedBlocks(rotatedBlocks, 740);
assert.ok(detectedAnchors.some((a) => a.category === 'Hamburguesas'));
assert.ok(detectedAnchors.some((a) => a.category === 'Sándwiches'));
assert.equal(layout.MARKER, 'VANTIX_MENU_OCR_LAYOUT_V3');

const capabilities = localOcr.runtimeCapabilities(true);
for (const key of ['tesseract','pdftotext','pdftoppm']) assert.equal(capabilities[key], true, `${key} debe estar instalado en CI`);
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
assert.match(browser, /VANTIX_MENU_OCR_LAYOUT_V3/);
assert.match(browser, /blocks:true/);
assert.match(browser, /detectVerticalCategories/);
assert.match(browser, /rotateClockwise/);
assert.match(browser, /layoutAware:true/);
assert.match(browser, /wordBoundingBoxes:true/);
assert.match(browser, /tesseract\.js@5/);
assert.match(browser, /pdfjs-dist@3\.11\.174/);
assert.match(browser, /PSM_MODES\s*=\s*\['6', '11', '4'\]/);
assert.match(browser, /user_defined_dpi:'220'/);
assert.match(browser, /preserveOriginalImage:true/);
assert.doesNotMatch(browser, /OPENAI_API_KEY/);

const quality = fs.readFileSync('src/web/restaurant-menu-ocr-quality-v2.js', 'utf8');
assert.match(quality, /VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2/);

const ui = fs.readFileSync('src/web/restaurant-menu-import-ui.js', 'utf8');
assert.match(ui, /status\.preserveOriginalImage/);
assert.match(ui, /3600/);
assert.match(ui, /\.94/);
assert.match(ui, /comparando varias lecturas/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-menu-layout-parser-v3\.js/);
assert.match(publicRoutes, /browserLayoutMarker: 'VANTIX_MENU_OCR_LAYOUT_V3'/);
assert.match(publicRoutes, /restaurant-menu-browser-ocr\.js/);
assert.match(publicRoutes, /restaurant-menu-ocr-quality-v2\.js/);
assert.match(publicRoutes, /browserFallback: true/);

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts.build, 'npx prisma generate');

console.log(JSON.stringify({ ok:true, serverProvider:'LOCAL_OCR', browserProvider:'BROWSER_OCR', quality:'LAYOUT_V3', capabilities, parsedProducts:rows.length, realisticProducts:realMenuRows.length, geometricProducts:layoutRows.length, apiKeyRequired:false, browserFallback:true }));
