'use strict';

const express = require('express');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Security/visit routes are intentionally evaluated before the legacy public Restaurant
// router so the permanent QR order endpoint cannot bypass current-visit authorization.
router.use(restaurantVisitPublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router };
