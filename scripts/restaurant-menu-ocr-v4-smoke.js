'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const strict = require('../src/web/restaurant-menu-ocr-strict-v4.js');

assert.equal(strict.MARKER, 'VANTIX_MENU_OCR_STRICT_V4');
for (const bad of ['yr', 'RNG', 'GAA', '000M', '26.000']) assert.equal(strict.plausibleName(bad), false, `debe rechazar nombre basura: ${bad}`);
for (const good of ['SENCILLA', 'CLÁSICA', 'FOOD HOUSE', 'SALCHIPAPAS TRADICIONAL', 'TORNADO DE POLLO', 'COMBO 1']) assert.equal(strict.plausibleName(good), true, `debe aceptar producto: ${good}`);

for (const bad of [31060, 81844, 1318, 4110008, 0, -25000]) assert.equal(strict.plausiblePrice(bad, 'COP'), false, `debe rechazar precio OCR imposible: ${bad}`);
for (const good of [5500, 8000, 18000, 19500, 23000, 31000, 41000]) assert.equal(strict.plausiblePrice(good, 'COP'), true, `debe aceptar precio COP: ${good}`);

const goodRow = { category:'Hamburguesas', subcategory:'SENCILLA', price:19500, confidence:.78 };
const goodSupport = [
  [{ category:'Hamburguesas', subcategory:'SENCILLA', price:19500 }],
  [{ category:'Hamburguesas', subcategory:'SENCILLA', price:19500 }],
  [{ category:'Hamburguesas', subcategory:'SENCILA', price:19500 }]
];
assert.equal(strict.filterRows([goodRow], goodSupport, 'COP').length, 1);

const unstable = { category:'Perros', subcategory:'wana', price:25000, confidence:.76 };
assert.equal(strict.filterRows([unstable], [[unstable], []], 'COP').length, 0, 'una lectura aislada no debe entrar');
const wrongPrice = { category:'Perros', subcategory:'PAR SASETRA', price:81844, confidence:.76 };
assert.equal(strict.filterRows([wrongPrice], [[wrongPrice], [wrongPrice]], 'COP').length, 0, 'precio no plausible debe descartarse incluso con consenso');

const browserV4 = fs.readFileSync('src/web/restaurant-menu-browser-ocr-v4.js', 'utf8');
assert.match(browserV4, /VANTIX_BROWSER_OCR_PREPROCESS_V4/);
assert.match(browserV4, /highContrastCanvas/);
assert.match(browserV4, /otsuThreshold/);
assert.match(browserV4, /BINARY_CONSENSUS/);
assert.match(browserV4, /consensus:true/);
assert.match(browserV4, /strictValidation:true/);
assert.match(browserV4, /binary-psm6/);
assert.match(browserV4, /binary-psm11/);
assert.match(browserV4, /binary-psm4/);
assert.match(browserV4, /original-psm6/);
assert.match(browserV4, /anchors\.length >= 3/);
assert.doesNotMatch(browserV4, /OPENAI_API_KEY/);

const cleanupService = fs.readFileSync('src/modules/restaurant/restaurant-menu-ocr-cleanup.service.js', 'utf8');
assert.match(cleanupService, /MENU-OCR-/);
assert.match(cleanupService, /restaurantMenuItem\.updateMany/);
assert.match(cleanupService, /active:false/);
assert.match(cleanupService, /producto\.updateMany/);
assert.match(cleanupService, /activo:false/);

const routes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.routes.js', 'utf8');
assert.match(routes, /carta-importacion\/importados-ocr/);
assert.match(routes, /cleanup\.clearImportedOcr/);
assert.match(routes, /requirePermission\('RESTAURANTE\.ADMINISTRAR'\)/);

const cleanupUi = fs.readFileSync('src/web/restaurant-menu-ocr-cleanup-ui.js', 'utf8');
assert.match(cleanupUi, /VANTIX_MENU_OCR_CLEANUP_UI_V1/);
assert.match(cleanupUi, /Borrar productos OCR/);
assert.match(cleanupUi, /Borrar lectura/);
assert.match(cleanupUi, /method:'DELETE'/);
assert.match(cleanupUi, /No afecta productos creados manualmente/);

const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-menu-import.public.routes.js', 'utf8');
assert.match(publicRoutes, /restaurant-menu-ocr-strict-v4\.js/);
assert.match(publicRoutes, /restaurant-menu-browser-ocr-v4\.js/);
assert.match(publicRoutes, /restaurant-menu-ocr-cleanup-ui\.js/);
assert.match(publicRoutes, /browserPreprocessMarker: 'VANTIX_BROWSER_OCR_PREPROCESS_V4'/);
assert.match(publicRoutes, /browserStrictMarker: 'VANTIX_MENU_OCR_STRICT_V4'/);
assert.match(publicRoutes, /browserCleanupMarker: 'VANTIX_MENU_OCR_CLEANUP_UI_V1'/);

console.log(JSON.stringify({
  ok:true,
  marker:'VANTIX_BROWSER_OCR_PREPROCESS_V4',
  strict:'VANTIX_MENU_OCR_STRICT_V4',
  rejects:['yr','RNG','GAA','000M',31060,81844,1318,4110008],
  cleanup:true
}));
