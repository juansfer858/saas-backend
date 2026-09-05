'use strict';

const express = require('express');
const { runtime, MARKER } = require('./restaurant-kds-windows-printer.public.routes');

const router = express.Router();
const ASSET_PATH = '/app/restaurant-kds-windows-printer.js';
const ASSET_VERSION = 'windows-printer-v2-direct';
const HTML_MARKER = 'VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_ASSET_V2';

router.get(ASSET_PATH, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-KDS-Windows-Printer-Asset', 'v2-direct-js');
  res.type('application/javascript').send(`/* ${HTML_MARKER} */\n/* ${MARKER} */\n${runtime}\n`);
});

function installKdsWindowsPrinterAsset(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/centro-de-control') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && source.includes('</body>') && !source.includes(HTML_MARKER)) {
      const loader = `<script id="${HTML_MARKER}" src="${ASSET_PATH}?v=${ASSET_VERSION}"></script>`;
      const patched = source.replace('</body>', `  ${loader}\n</body>`);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-KDS-Windows-Printer-Loader', 'v2-direct-asset');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = {
  ASSET_PATH,
  ASSET_VERSION,
  HTML_MARKER,
  installKdsWindowsPrinterAsset,
  restaurantKdsWindowsPrinterAssetPublicRouter: router
};
