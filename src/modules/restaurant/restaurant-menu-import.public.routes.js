'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const menuImport = require('./restaurant-menu-import.service');
const localOcr = require('./restaurant-menu-local-ocr.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const menuUiPath = path.join(webRoot, 'restaurant-menu-import-ui.js');
const browserOcrPath = path.join(webRoot, 'restaurant-menu-browser-ocr.js');
const qualityOcrPath = path.join(webRoot, 'restaurant-menu-ocr-quality-v2.js');

router.get('/app/restaurant-menu-import-ui.js', (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send([
      fs.readFileSync(menuUiPath, 'utf8'),
      fs.readFileSync(browserOcrPath, 'utf8'),
      fs.readFileSync(qualityOcrPath, 'utf8')
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
      browserPostprocessMarker: 'VANTIX_MENU_OCR_QUALITY_POSTPROCESS_V2',
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
