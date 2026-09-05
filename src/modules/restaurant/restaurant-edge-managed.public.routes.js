'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const edgeConfigHtmlPath = path.join(webRoot, 'edge-config.html');
const edgeTenantManagedJsPath = path.join(webRoot, 'edge-tenant-managed.js');

router.get('/app/edge-tenant-managed.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(edgeTenantManagedJsPath);
});

router.get('/app/edge', async (_req, res, next) => {
  try {
    const html = await fs.promises.readFile(edgeConfigHtmlPath, 'utf8');
    const script = '<script src="/app/edge-tenant-managed.js?v=platform-managed-v1"></script>';
    const rendered = html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Edge-Updates', 'PLATFORM_MANAGED');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
});

module.exports = { restaurantEdgeManagedPublicRouter: router };
