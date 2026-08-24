const express = require('express');
const path = require('node:path');

const router = express.Router();
const landingPath = path.join(__dirname, '..', '..', 'web', 'public-installer.html');

router.get('/instalar', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(landingPath);
});

router.get('/instalar-restaurantes', (_req, res) => res.redirect(302, '/instalar'));
router.get('/demo-restaurantes', (_req, res) => res.redirect(302, '/instalar'));

module.exports = { publicInstallerRouter: router };
