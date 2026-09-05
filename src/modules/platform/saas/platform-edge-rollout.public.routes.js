'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', '..', 'web');
const platformAdminHtmlPath = path.join(webRoot, 'platform-admin.html');
const fiscalGovernancePath = path.join(webRoot, 'platform-restaurant-fiscal-governance.js');
const edgeRolloutPath = path.join(webRoot, 'platform-edge-rollout.js');

router.get('/platform/restaurant-fiscal-governance.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(fiscalGovernancePath);
});

router.get('/platform/edge-rollout.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(edgeRolloutPath);
});

async function sendPlatformAdmin(_req, res, next) {
  try {
    const html = await fs.promises.readFile(platformAdminHtmlPath, 'utf8');
    const scripts = [
      '<script src="/platform/restaurant-fiscal-governance.js?v=platform-only-v1"></script>',
      '<script src="/platform/edge-rollout.js?v=platform-edge-central-v3"></script>'
    ].join('');
    const rendered = html.includes('</body>') ? html.replace('</body>', `${scripts}</body>`) : `${html}${scripts}`;
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Platform-Edge', 'CENTRAL_ROLLOUT_V3_RECOVERY');
    res.type('html').send(rendered);
  } catch (error) { next(error); }
}

router.get('/platform', sendPlatformAdmin);
router.get('/platform/admin', sendPlatformAdmin);

module.exports = { platformEdgeRolloutPublicRouter: router };
