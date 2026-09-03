'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const menuImport = require('./restaurant-menu-import.service');
const localOcr = require('./restaurant-menu-local-ocr.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const menuUiPath = path.join(webRoot, 'restaurant-menu-import-ui.js');
const layoutOcrPath = path.join(webRoot, 'restaurant-menu-layout-parser-v3.js');
const strictOcrPath = path.join(webRoot, 'restaurant-menu-ocr-strict-v4.js');
const browserOcrPath = path.join(webRoot, 'restaurant-menu-browser-ocr.js');
const browserOcrV4Path = path.join(webRoot, 'restaurant-menu-browser-ocr-v4.js');
const qualityOcrPath = path.join(webRoot, 'restaurant-menu-ocr-quality-v2.js');
const cleanupUiPath = path.join(webRoot, 'restaurant-menu-ocr-cleanup-ui.js');
const editableUiPath = path.join(webRoot, 'restaurant-menu-ocr-editable-ui-v1.js');
const productEditUiPath = path.join(webRoot, 'restaurant-menu-ocr-product-edit-v6.js');

function patchMenuImportUpload10Mb(source) {
  if (source.includes('VANTIX_MENU_OCR_END_TO_END_10MB_V7')) return source;
  const legacyLimit = 'const MAX_BYTES = 5 * 1024 * 1024;';
  const legacyUpload = `const dataUrl = await fileToDataUrl(prepared);\n      const dataBase64 = dataUrl.split(',')[1] || '';\n      const result = await api('/api/v1/restaurante/carta-importacion/analizar', {\n        method:'POST',\n        body:JSON.stringify({ fileName:currentFileName, mimeType:prepared.type, dataBase64 })\n      });`;
  if (!source.includes(legacyLimit) || !source.includes(legacyUpload)) {
    throw new Error('RESTAURANT_MENU_OCR_UPLOAD_PATCH_TARGET_NOT_FOUND');
  }
  const adaptiveUpload = `// VANTIX_MENU_OCR_END_TO_END_10MB_V7: servidor=binario 10 MiB; fallback navegador=OCR local 10 MiB.\n      let result;\n      if (String(status.provider || '').toUpperCase() === 'BROWSER_OCR') {\n        const dataUrl = await fileToDataUrl(prepared);\n        const dataBase64 = dataUrl.split(',')[1] || '';\n        result = await api('/api/v1/restaurante/carta-importacion/analizar', {\n          method:'POST',\n          body:JSON.stringify({ fileName:currentFileName, mimeType:prepared.type, dataBase64 })\n        });\n      } else {\n        const uploadUrl = \`/api/v1/restaurante/carta-importacion/analizar-binario?fileName=\${encodeURIComponent(currentFileName)}&mimeType=\${encodeURIComponent(prepared.type)}\`;\n        const uploadResponse = await fetch(uploadUrl, {\n          method:'POST',\n          cache:'no-store',\n          headers:{\n            'Content-Type':'application/octet-stream',\n            Authorization:\`Bearer \${session.token}\`,\n            'x-tenant-subdomain':session.subdomain\n          },\n          body:prepared\n        });\n        let uploadBody = {};\n        try { uploadBody = await uploadResponse.json(); } catch {}\n        if (!uploadResponse.ok) throw new Error(uploadBody?.error?.message || uploadBody?.message || \`HTTP \${uploadResponse.status}\`);\n        result = uploadBody.data;\n      }`;
  return source
    .replace(legacyLimit, 'const MAX_BYTES = 10 * 1024 * 1024;')
    .replace(legacyUpload, adaptiveUpload);
}

function patchBrowserOcr10Mb(source) {
  const output = String(source)
    .replace(/const MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024;/g, 'const MAX_BYTES = 10 * 1024 * 1024;')
    .replaceAll('La carta supera el máximo de 5 MB.', 'La carta supera el máximo de 10 MB.')
    .replaceAll('El archivo es muy grande. Máximo 5 MB.', 'El archivo es muy grande. Máximo 10 MB.');
  if (/MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(output) || /Máximo 5 MB|máximo de 5 MB/.test(output)) {
    throw new Error('RESTAURANT_MENU_OCR_BROWSER_5MB_LIMIT_STILL_PRESENT');
  }
  return output;
}

function patchDynamicCommercialCategories(source) {
  const input = String(source);
  let output = input;

  output = output.replace(
    `    const normalized = key(value);\n    if (headings.has(normalized)) return headings.get(normalized);`,
    `    const normalized = key(value);\n    if (headings.has(normalized)) return headings.get(normalized);\n    // VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8: un título visible de la carta manda sobre familias convencionales.\n    if (/^.{2,45}\\s+[-–—]\\s+.{2,45}$/.test(value) && !/\\$|\\d{3,}/.test(value)) return value;`
  );

  output = output.replace(
    `      const family = familyCategory(name), op = operational(family || category, name), commercial = family || (category !== 'Otros' ? category : fallbackCategory(op));`,
    `      const family = familyCategory(name);\n      const commercial = category !== 'Otros' ? category : (family || fallbackCategory(operational(category, name)));\n      const op = operational(commercial, name);`
  );

  output = output.replace(
    `    const family = familyCategory(name);\n    const category = family || explicitCategory || categoryAtY(y, anchors) || 'Platos';`,
    `    const family = familyCategory(name);\n    const category = explicitCategory || categoryAtY(y, anchors) || family || 'Otros';`
  );

  output = output.replace(
    `      const category = family(name) || clean(item.category || 'Platos') || 'Platos';`,
    `      const category = clean(item.category || '') || family(name) || 'Otros';`
  );

  if (output !== input && !output.includes('VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8')) {
    output = `// VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8\n${output}`;
  }
  return output;
}

function buildMenuImportBrowserAsset() {
  const asset = [
    patchMenuImportUpload10Mb(fs.readFileSync(menuUiPath, 'utf8')),
    patchDynamicCommercialCategories(fs.readFileSync(layoutOcrPath, 'utf8')),
    fs.readFileSync(strictOcrPath, 'utf8'),
    patchDynamicCommercialCategories(patchBrowserOcr10Mb(fs.readFileSync(browserOcrPath, 'utf8'))),
    patchBrowserOcr10Mb(fs.readFileSync(browserOcrV4Path, 'utf8')),
    patchDynamicCommercialCategories(fs.readFileSync(qualityOcrPath, 'utf8')),
    fs.readFileSync(cleanupUiPath, 'utf8'),
    fs.readFileSync(editableUiPath, 'utf8'),
    fs.readFileSync(productEditUiPath, 'utf8')
  ].join('\n');
  if (/MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(asset) || /Máximo 5 MB|máximo de 5 MB/.test(asset)) {
    throw new Error('RESTAURANT_MENU_OCR_FINAL_ASSET_5MB_LIMIT_STILL_PRESENT');
  }
  if (/commercial\s*=\s*family\s*\|\||category\s*=\s*family\(name\)\s*\|\|\s*clean\(item\.category|category\s*=\s*family\s*\|\|\s*explicitCategory/.test(asset)) {
    throw new Error('RESTAURANT_MENU_OCR_DYNAMIC_CATEGORY_PRIORITY_REGRESSION');
  }
  if (!asset.includes('VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8')) {
    throw new Error('RESTAURANT_MENU_OCR_DYNAMIC_CATEGORY_MARKER_MISSING');
  }
  return asset;
}

router.get('/app/restaurant-menu-import-ui.js', (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Menu-OCR-Upload', '10mb-adaptive-v7');
    res.set('X-VantixGC-Menu-OCR-Browser-Limit', '10mb-v7');
    res.set('X-VantixGC-Menu-OCR-Categories', 'detected-heading-v8');
    res.set('X-VantixGC-Menu-OCR-Product-Edit', 'persisted-v6');
    res.type('application/javascript').send(buildMenuImportBrowserAsset());
  } catch (error) { next(error); }
});

router.get('/api/public/restaurante/menu-ocr-readiness', (_req, res) => {
  const status = localOcr.providerStatus(menuImport.MAX_FILE_BYTES);
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    data: {
      configured: status.configured,
      provider: status.provider,
      maxBytes: status.maxBytes,
      browserMaxBytes: menuImport.MAX_FILE_BYTES,
      uploadMode: 'ADAPTIVE_BINARY_OR_BROWSER',
      categoryMode: 'DETECTED_VISIBLE_HEADING',
      categoryFallback: 'INFER_ONLY_WHEN_NO_VISIBLE_HEADING',
      browserFallback: true,
      browserMarker: 'VANTIX_BROWSER_OCR_V1',
      browserQualityMarker: 'VANTIX_BROWSER_OCR_MULTIPASS_V2',
      browserLayoutMarker: 'VANTIX_MENU_OCR_LAYOUT_V3',
      browserPreprocessMarker: 'VANTIX_BROWSER_OCR_PREPROCESS_V4',
      browserStrictMarker: 'VANTIX_MENU_OCR_STRICT_V4',
      browserPostprocessMarker: 'VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2',
      browserCleanupMarker: 'VANTIX_MENU_OCR_CLEANUP_UI_V1',
      browserEditableMarker: 'VANTIX_MENU_OCR_EDITABLE_UI_V1',
      browserUploadMarker: 'VANTIX_MENU_OCR_END_TO_END_10MB_V7',
      browserLimitMarker: 'VANTIX_MENU_OCR_BROWSER_10MB_V7',
      browserCategoryMarker: 'VANTIX_MENU_OCR_DYNAMIC_CATEGORIES_V8',
      browserProductEditMarker: 'VANTIX_MENU_OCR_EDIT_V6',
      capabilities: {
        imageOcr: Boolean(status.capabilities?.imageOcr),
        pdfText: Boolean(status.capabilities?.pdfText),
        pdfScan: Boolean(status.capabilities?.pdfScan),
        maxPdfPages: Number(status.capabilities?.maxPdfPages || 0)
      }
    }
  });
});

module.exports = {
  restaurantMenuImportPublicRouter: router,
  patchMenuImportUpload10Mb,
  patchBrowserOcr10Mb,
  patchDynamicCommercialCategories,
  buildMenuImportBrowserAsset
};