'use strict';

const express = require('express');
const { restaurantMenuImportPublicRouter } = require('./restaurant-menu-import.public.routes');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Isolated extension assets and security/visit routes are evaluated before the legacy public
// Restaurant router. The delegated base router remains the owner of the established surfaces:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// /app/centro-de-control-preview · /api/public/restaurante/demo-readiness
// /app/v2-preview/dashboard · /app/v2-preview/ventas
router.use(restaurantMenuImportPublicRouter);
router.use(restaurantVisitPublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router };
