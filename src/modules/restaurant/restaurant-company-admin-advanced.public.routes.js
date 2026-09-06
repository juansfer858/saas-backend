'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();
const ADMIN_PATH = '/app/configuracion-avanzada';
const ASSET_PATH = '/app/restaurant-company-admin-advanced.js';
const MARKER = 'VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V2';
const SCRIPT_TAG = `<script src="${ASSET_PATH}?v=2" data-vantix-restaurant-company-admin="${MARKER}"></script>`;
const assetFile = path.join(__dirname, '..', '..', 'web', 'restaurant-company-admin-advanced.js');

router.get(ASSET_PATH, (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Company-Admin', 'v2-advanced');
  res.type('application/javascript').sendFile(assetFile);
});

function installCompanyAdminAdvancedAsset(req, res, next) {
  if (req.method !== 'GET' || req.path !== ADMIN_PATH) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = source.includes('</body>')
        ? source.replace('</body>', `${SCRIPT_TAG}</body>`)
        : `${source}${SCRIPT_TAG}`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
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
  MARKER
};
