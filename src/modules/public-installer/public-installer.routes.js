const express = require('express');
const path = require('node:path');
const { restaurantSelfServicePublicRouter } = require('../self-service/restaurant-self-service.routes');

const router = express.Router();
const webRoot = path.join(__dirname, '..', '..', 'web');
const landingPath = path.join(webRoot, 'public-installer.html');
const restaurantLandingPath = path.join(webRoot, 'restaurant-public.html');
const restaurantDemoPath = path.join(webRoot, 'restaurant-public-demo.html');
const restaurantSignupPath = path.join(webRoot, 'restaurant-signup.html');
const restaurantOnboardingPath = path.join(webRoot, 'restaurant-onboarding.html');

router.use('/api/public/restaurantes', restaurantSelfServicePublicRouter);

router.get('/restaurantes', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(restaurantLandingPath);
});
router.get('/restaurantes/demo', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(restaurantDemoPath);
});
router.get('/restaurantes/crear', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(restaurantSignupPath);
});
router.get('/app/onboarding', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(restaurantOnboardingPath);
});

router.get('/instalar', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('html').sendFile(landingPath);
});

router.get('/instalar-restaurantes', (_req, res) => res.redirect(302, '/restaurantes'));
router.get('/demo-restaurantes', (_req, res) => res.redirect(302, '/restaurantes/demo'));

module.exports = { publicInstallerRouter: router };
