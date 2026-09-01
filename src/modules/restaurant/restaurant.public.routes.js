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

// Isolated extension assets and security/visit routes are evaluated before the legacy public
// Restaurant router. The delegated base router remains the owner of the established surfaces:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// /app/centro-de-control-preview · /api/public/restaurante/demo-readiness
// /app/v2-preview/dashboard · /app/v2-preview/ventas
// Electronic-payment V22 is first only for its exact QR/payment and waiter PWA override paths;
// all other requests fall through to the established refresh/call/visit layers unchanged.
// The refresh layer remains the compatibility owner of the installed waiter shell contract.
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
