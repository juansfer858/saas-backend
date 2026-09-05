'use strict';

const express = require('express');
const { runtime, MARKER } = require('./restaurant-kds-windows-printer.public.routes');

const router = express.Router();
const ASSET_PATH = '/app/restaurant-kds-windows-printer.js';
const ASSET_VERSION = 'windows-printer-v3-relay-first';
const HTML_MARKER = 'VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_ASSET_V3';

const STRICT_ONLINE_BLOCK = `  async function onlineEdge(){
    const rows=await api('/api/v1/edge/installations');
    const online=(Array.isArray(rows)?rows:[]).filter((row)=>row?.agent?.state==='ACTIVE'&&row?.installation?.online===true);
    if(!online.length)throw new Error('El Edge del restaurante no está en línea.');
    return online[0];
  }`;

const RELAY_FIRST_BLOCK = `  async function onlineEdge(){
    const rows=await api('/api/v1/edge/installations');
    const active=(Array.isArray(rows)?rows:[]).filter((row)=>row?.agent?.state==='ACTIVE');
    if(!active.length)throw new Error('No hay un Edge activo registrado para este restaurante.');
    return active.find((row)=>row?.installation?.online===true)
      ||active.find((row)=>row?.installation?.relayConnected===true)
      ||active[0];
  }`;

const browserRuntime = runtime.replace(STRICT_ONLINE_BLOCK, RELAY_FIRST_BLOCK);
if (browserRuntime === runtime) throw new Error('KDS_WINDOWS_PRINTER_RELAY_FIRST_PATCH_TARGET_NOT_FOUND');

router.get(ASSET_PATH, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-KDS-Windows-Printer-Asset', 'v3-relay-first-js');
  res.type('application/javascript').send(`/* ${HTML_MARKER} */\n/* ${MARKER} */\n${browserRuntime}\n`);
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
      res.set('X-VantixGC-KDS-Windows-Printer-Loader', 'v3-relay-first-asset');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = {
  ASSET_PATH,
  ASSET_VERSION,
  HTML_MARKER,
  browserRuntime,
  installKdsWindowsPrinterAsset,
  restaurantKdsWindowsPrinterAssetPublicRouter: router
};
