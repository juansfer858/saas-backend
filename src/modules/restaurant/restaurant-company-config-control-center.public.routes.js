'use strict';

const express = require('express');
const path = require('path');

const MARKER = 'VANTIX_RESTAURANT_COMPANY_CONFIG_CONTROL_CENTER_V1';
const WEB_DIR = path.join(__dirname, '../../web');
const SCRIPT_SRC = '/app/restaurant-company-config-control-center.js?v=1';
const SCRIPT_TAG = `<script src="${SCRIPT_SRC}"></script>`;

const restaurantCompanyConfigControlCenterPublicRouter = express.Router();

restaurantCompanyConfigControlCenterPublicRouter.get('/app/restaurant-company-config-control-center.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Company-Config', 'v1-control-center');
  res.sendFile(path.join(WEB_DIR, 'restaurant-company-config-control-center.js'));
});

function installCompanyConfigControlCenterAsset(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/centro-de-control') return next();

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER) && !source.includes(SCRIPT_SRC)) {
      const marker = `<meta name="vantixgc-restaurant-company-config" content="${MARKER}">`;
      let patched = source.includes('</head>') ? source.replace('</head>', `${marker}</head>`) : source;
      patched = patched.includes('</body>') ? patched.replace('</body>', `${SCRIPT_TAG}</body>`) : `${patched}\n${SCRIPT_TAG}`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Company-Config', 'v1-control-center');
    return originalSend(body);
  };

  return next();
}

module.exports = {
  MARKER,
  SCRIPT_SRC,
  restaurantCompanyConfigControlCenterPublicRouter,
  installCompanyConfigControlCenterAsset
};
