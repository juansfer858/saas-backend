const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { restaurantSelfServicePublicRouter } = require('../self-service/restaurant-self-service.routes');
const windowsInstaller = require('./windows-installer.service');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const landingPath = path.join(webRoot, 'public-installer.html');
const restaurantLandingPath = path.join(webRoot, 'restaurant-public.html');
const restaurantDemoPath = path.join(webRoot, 'restaurant-public-demo.html');
const restaurantSignupPath = path.join(webRoot, 'restaurant-signup.html');
const restaurantOnboardingPath = path.join(webRoot, 'restaurant-onboarding.html');
const restaurantPublicThemePath = path.join(webRoot, 'restaurant-public-theme.css');

router.use('/api/public/restaurantes', restaurantSelfServicePublicRouter);

function publicBaseUrl(req) {
  const configured = String(process.env.CORE_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

async function sendRestaurantPublicHtml(filePath, res, next) {
  try {
    const html = await fs.promises.readFile(filePath, 'utf8');
    const themeTag = '<link rel="stylesheet" href="/restaurantes/theme-v1.css">';
    const themed = (html.includes('</head>') ? html.replace('</head>', `${themeTag}</head>`) : `${themeTag}${html}`)
      .replace(/<body(\s[^>]*)?>/i, (match, attrs = '') => {
        if (/class\s*=/.test(attrs)) return match.replace(/class=(['"])(.*?)\1/i, (_m, q, classes) => `class=${q}${classes} vr-public-theme${q}`);
        return `<body${attrs} class="vr-public-theme">`;
      });
    res.set('Cache-Control', 'no-store, max-age=0');
    res.type('html').send(themed);
  } catch (error) { next(error); }
}

router.get('/restaurantes/theme-v1.css', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/css').sendFile(restaurantPublicThemePath);
});

router.get('/restaurantes', (_req, res, next) => sendRestaurantPublicHtml(restaurantLandingPath, res, next));
router.get('/restaurantes/demo', (_req, res, next) => sendRestaurantPublicHtml(restaurantDemoPath, res, next));
router.get('/restaurantes/crear', (_req, res, next) => sendRestaurantPublicHtml(restaurantSignupPath, res, next));
router.get('/app/onboarding', (_req, res, next) => sendRestaurantPublicHtml(restaurantOnboardingPath, res, next));

router.get('/instalar', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(landingPath);
});

router.get('/instalar/windows.cmd', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Content-Disposition', 'attachment; filename="INSTALAR_VANTIXGC_RESTAURANTES.cmd"');
  res.type('text/plain').send(windowsInstaller.genericInstallerCmd(publicBaseUrl(req)));
});

router.get('/instalar/windows.ps1', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('text/plain').send(windowsInstaller.genericInstallerPowerShell(publicBaseUrl(req)));
});

router.get('/instalar-restaurantes', (_req, res) => res.redirect(302, '/restaurantes'));
router.get('/demo-restaurantes', (_req, res) => res.redirect(302, '/restaurantes/demo'));

module.exports = { publicInstallerRouter: router };
