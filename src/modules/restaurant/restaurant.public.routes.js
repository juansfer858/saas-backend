'use strict';

const express = require('express');
const { restaurantElectronicPaymentPublicRouter } = require('./restaurant-electronic-payment.public.routes');
const { restaurantWaiterCallRefreshPublicRouter } = require('./restaurant-waiter-call-refresh.public.routes');
const { restaurantWaiterCallPublicRouter } = require('./restaurant-waiter-call.public.routes');
const { restaurantMenuImportPublicRouter } = require('./restaurant-menu-import.public.routes');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantClientTrackingPublicRouter } = require('./restaurant-client-tracking.public.routes');
const { restaurantWaiterDevicePublicRouter } = require('./restaurant-waiter-device.public.routes');
const { restaurantDeliveryPublicRouter } = require('./restaurant-delivery.public.routes');
const { restaurantEmployeesPublicRouter } = require('./restaurant-employees.public.routes');
const { restaurantEmployeeWorkPublicRouter } = require('./restaurant-employee-work.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Extension layers are ordered intentionally. Electronic-payment V22 owns only the
// exact QR asset/PWA paths and payment-confirmation endpoints that it overrides; all
// existing waiter-call, visit, menu and legacy surfaces fall through unchanged.
router.use(restaurantElectronicPaymentPublicRouter);
router.use(restaurantWaiterCallRefreshPublicRouter);
router.use(restaurantWaiterCallPublicRouter);
router.use(restaurantMenuImportPublicRouter);
router.use(restaurantVisitPublicRouter);
router.use(restaurantClientTrackingPublicRouter);
router.use(restaurantWaiterDevicePublicRouter);
router.use(restaurantDeliveryPublicRouter);
router.use(restaurantEmployeesPublicRouter);
router.use(restaurantEmployeeWorkPublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router };
