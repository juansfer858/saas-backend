'use strict';

const express = require('express');
const { restaurantMenuImportPublicRouter } = require('./restaurant-menu-import.public.routes');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Isolated extension assets and security/visit routes are evaluated before the legacy public
// Restaurant router. The delegated base router remains the owner of the established surfaces.
router.use(restaurantMenuImportPublicRouter);
router.use(restaurantVisitPublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router };
