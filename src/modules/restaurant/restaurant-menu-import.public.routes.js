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

router.get('/app/restaurant-menu-import-ui.js', (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send([
      fs.readFileSync(menuUiPath, 'utf8'),
      fs.readFileSync(layoutOcrPath, 'utf8'),
      fs.readFileSync(strictOcrPath, 'utf8'),
      fs.readFileSync(browserOcrPath, 'utf8'),
      fs.readFileSync(browserOcrV4Path, 'utf8'),
      fs.readFileSync(qualityOcrPath, 'utf8'),
      fs.readFileSync(cleanupUiPath, 'utf8')
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
      browserFallback: true,
      browserMarker: 'VANTIX_BROWSER_OCR_V1',
      browserQualityMarker: 'VANTIX_BROWSER_OCR_MULTIPASS_V2',
      browserLayoutMarker: 'VANTIX_MENU_OCR_LAYOUT_V3',
      browserPreprocessMarker: 'VANTIX_BROWSER_OCR_PREPROCESS_V4',
      browserStrictMarker: 'VANTIX_MENU_OCR_STRICT_V4',
      browserPostprocessMarker: 'VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2',
      browserCleanupMarker: 'VANTIX_MENU_OCR_CLEANUP_UI_V1',
      capabilities: {
        imageOcr: Boolean(status.capabilities?.imageOcr),
        pdfText: Boolean(status.capabilities?.pdfText),
        pdfScan: Boolean(status.capabilities?.pdfScan),
        maxPdfPages: Number(status.capabilities?.maxPdfPages || 0)
      }
    }
  });
});

module.exports = { restaurantMenuImportPublicRouter: router };
