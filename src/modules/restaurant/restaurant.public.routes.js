'use strict';

const express = require('express');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Security/visit routes are intentionally evaluated before the legacy public Restaurant
// router so the permanent QR order endpoint cannot bypass current-visit authorization.
// The delegated base router remains the owner of the established public/operator surfaces:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// /app/centro-de-control-preview · /api/public/restaurante/demo-readiness
// /app/v2-preview/dashboard · /app/v2-preview/ventas
router.use(restaurantVisitPublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router };
