'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const ADMIN_PATH = '/app/configuracion-avanzada';
const ASSET_PATH = '/app/restaurant-company-admin-advanced.js';
const AUDIT_ASSET_PATH = '/app/restaurant-audit-log-c84.js';
const MARKER = 'VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V2';
const AUDIT_MARKER = 'VANTIX_RESTAURANT_AUDIT_LOG_C84';
const SCRIPT_TAG = `<script src="${ASSET_PATH}?v=2" data-vantix-restaurant-company-admin="${MARKER}"></script>`;
const AUDIT_SCRIPT_TAG = `<script src="${AUDIT_ASSET_PATH}?v=84" data-vantix-restaurant-audit="${AUDIT_MARKER}"></script>`;
const assetFile = path.join(__dirname, '..', '..', 'web', 'restaurant-company-admin-advanced.js');
const auditAssetFile = path.join(__dirname, '..', '..', 'web', 'restaurant-audit-log-c84.js');

router.get(ASSET_PATH, (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Company-Admin', 'v2-advanced');
  res.type('application/javascript').sendFile(assetFile);
});

router.get(AUDIT_ASSET_PATH, (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Audit', 'c84-read-only');
  res.type('application/javascript').sendFile(auditAssetFile);
});

function installCompanyAdminAdvancedAsset(req, res, next) {
  if (req.method !== 'GET' || req.path !== ADMIN_PATH) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const tags = [];
      if (!source.includes(MARKER)) tags.push(SCRIPT_TAG);
      if (!source.includes(AUDIT_MARKER)) tags.push(AUDIT_SCRIPT_TAG);
      if (tags.length) {
        const injection = tags.join('');
        const patched = source.includes('</body>')
          ? source.replace('</body>', `${injection}</body>`)
          : `${source}${injection}`;
        body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      }
    }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-Restaurant-Company-Admin', 'v2-advanced');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  restaurantCompanyAdminAdvancedPublicRouter: router,
  installCompanyAdminAdvancedAsset,
  ADMIN_PATH,
  ASSET_PATH,
  AUDIT_ASSET_PATH,
  MARKER,
  AUDIT_MARKER
};
