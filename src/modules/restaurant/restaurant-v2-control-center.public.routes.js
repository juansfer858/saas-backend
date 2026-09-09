'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {
  ASSET_PATH: KDS_WINDOWS_ASSET_PATH,
  ASSET_VERSION: KDS_WINDOWS_ASSET_VERSION,
  HTML_MARKER: KDS_WINDOWS_HTML_MARKER,
  LOADER_HEADER_VALUE: KDS_WINDOWS_LOADER_HEADER_VALUE
} = require('./restaurant-kds-windows-printer-asset.public.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '../../web');
const HEADER_VALUE = 'v2-control-center-bridge-p6-5';

async function sendP10CompatibilityShell(_req, res, next) {
  try {
    const html = await fs.promises.readFile(path.join(webRoot, 'restaurant.html'), 'utf8');
    const kdsWindowsLoader = `<script id="${KDS_WINDOWS_HTML_MARKER}" src="${KDS_WINDOWS_ASSET_PATH}?v=${KDS_WINDOWS_ASSET_VERSION}"></script>`;
    const rendered = html
      .replace('<title>VantixGC Restaurante</title>', '<title>VantixGC Restaurante · Centro de control V2</title>')
      .replace('</head>', '  <link rel="stylesheet" href="/app/restaurant-control-center.css?v=operational-v1">\n</head>')
      .replace('</body>', `  <script src="/app/restaurant-control-center.js?v=operational-v1"></script>\n  <script src="/app/restaurant-v2-control-center-bridge.js?v=p6-5"></script>\n  ${kdsWindowsLoader}\n</body>`);
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('X-VantixGC-Restaurant-Control', 'operational-shell-v1');
    res.set('X-VantixGC-Restaurant-Control-V2', HEADER_VALUE);
    res.set('X-VantixGC-Restaurant-Control-Engine', 'restaurant-ui-v1');
    res.set('X-VantixGC-Restaurant-Control-V2-Engine', 'embedded-independent-modules');
    res.set('X-VantixGC-Restaurant-Control-P10-Compatibility', 'true');
    res.set('X-VantixGC-Restaurant-Control-Fallback', '/app/restaurante-v1');
    res.set('X-VantixGC-KDS-Windows-Printer-Loader', KDS_WINDOWS_LOADER_HEADER_VALUE);
    res.type('html').send(rendered);
  } catch (error) { next(error); }
}

// P11 owns /app/centro-de-control before this router. Keep the old canonical
// handler as a safe fallback, and expose a dedicated P10 alias for tenants that
// have not retired V1 yet.
router.get('/app/centro-de-control', sendP10CompatibilityShell);
router.get('/app/centro-de-control-p10', sendP10CompatibilityShell);

router.get('/app/restaurant-v2-control-center-bridge.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-VantixGC-Restaurant-Control', 'operational-shell-v1');
  res.set('X-VantixGC-Restaurant-Control-V2', HEADER_VALUE);
  res.type('application/javascript').sendFile(path.join(webRoot, 'restaurant-v2-control-center-bridge.js'));
});

module.exports = { HEADER_VALUE, restaurantV2ControlCenterPublicRouter:router, sendP10CompatibilityShell };
