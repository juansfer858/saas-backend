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

function patchMenuImportUpload10Mb(source) {
  if (source.includes('VANTIX_MENU_OCR_UPLOAD_10MB_V5')) return source;
  const legacyLimit = 'const MAX_BYTES = 5 * 1024 * 1024;';
  const legacyUpload = `const dataUrl = await fileToDataUrl(prepared);\n      const dataBase64 = dataUrl.split(',')[1] || '';\n      const result = await api('/api/v1/restaurante/carta-importacion/analizar', {\n        method:'POST',\n        body:JSON.stringify({ fileName:currentFileName, mimeType:prepared.type, dataBase64 })\n      });`;
  if (!source.includes(legacyLimit) || !source.includes(legacyUpload)) {
    throw new Error('RESTAURANT_MENU_OCR_UPLOAD_PATCH_TARGET_NOT_FOUND');
  }
  const binaryUpload = `// VANTIX_MENU_OCR_UPLOAD_10MB_V5: archivos hasta 10 MiB viajan binarios, sin inflación Base64 en HTTP.\n      const uploadUrl = \`/api/v1/restaurante/carta-importacion/analizar-binario?fileName=\${encodeURIComponent(currentFileName)}&mimeType=\${encodeURIComponent(prepared.type)}\`;\n      const uploadResponse = await fetch(uploadUrl, {\n        method:'POST',\n        cache:'no-store',\n        headers:{\n          'Content-Type':'application/octet-stream',\n          Authorization:\`Bearer \${session.token}\`,\n          'x-tenant-subdomain':session.subdomain\n        },\n        body:prepared\n      });\n      let uploadBody = {};\n      try { uploadBody = await uploadResponse.json(); } catch {}\n      if (!uploadResponse.ok) throw new Error(uploadBody?.error?.message || uploadBody?.message || \`HTTP \${uploadResponse.status}\`);\n      const result = uploadBody.data;`;
  return source
    .replace(legacyLimit, 'const MAX_BYTES = 10 * 1024 * 1024;')
    .replace(legacyUpload, binaryUpload);
}

router.get('/app/restaurant-menu-import-ui.js', (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Menu-OCR-Upload', '10mb-binary-v5');
    res.type('application/javascript').send([
      patchMenuImportUpload10Mb(fs.readFileSync(menuUiPath, 'utf8')),
      fs.readFileSync(layoutOcrPath, 'utf8'),
      fs.readFileSync(strictOcrPath, 'utf8'),
      fs.readFileSync(browserOcrPath, 'utf8'),
      fs.readFileSync(browserOcrV4Path, 'utf8'),
      fs.readFileSync(qualityOcrPath, 'utf8'),
      fs.readFileSync(cleanupUiPath, 'utf8'),
      fs.readFileSync(editableUiPath, 'utf8')
    ].join('\n'));
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
      uploadMode: 'BINARY',
      browserFallback: true,
      browserMarker: 'VANTIX_BROWSER_OCR_V1',
      browserQualityMarker: 'VANTIX_BROWSER_OCR_MULTIPASS_V2',
      browserLayoutMarker: 'VANTIX_MENU_OCR_LAYOUT_V3',
      browserPreprocessMarker: 'VANTIX_BROWSER_OCR_PREPROCESS_V4',
      browserStrictMarker: 'VANTIX_MENU_OCR_STRICT_V4',
      browserPostprocessMarker: 'VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2',
      browserCleanupMarker: 'VANTIX_MENU_OCR_CLEANUP_UI_V1',
      browserEditableMarker: 'VANTIX_MENU_OCR_EDITABLE_UI_V1',
      browserUploadMarker: 'VANTIX_MENU_OCR_UPLOAD_10MB_V5',
      capabilities: {
        imageOcr: Boolean(status.capabilities?.imageOcr),
        pdfText: Boolean(status.capabilities?.pdfText),
        pdfScan: Boolean(status.capabilities?.pdfScan),
        maxPdfPages: Number(status.capabilities?.maxPdfPages || 0)
      }
    }
  });
});

module.exports = { restaurantMenuImportPublicRouter: router, patchMenuImportUpload10Mb };
