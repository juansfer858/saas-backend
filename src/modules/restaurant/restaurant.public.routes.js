'use strict';

const express = require('express');
const { coreAdminPwaPublicRouter } = require('../platform/core-admin-pwa.public.routes');
const { restaurantPublicRealtimePublisher } = require('./restaurant-public-realtime-publisher');
const { restaurantQrPresenceRealtimePublicRouter } = require('./restaurant-qr-presence-realtime.public.routes');
const { restaurantQrOrderWaiterAlertPublicRouter } = require('./restaurant-qr-order-waiter-alert.public.routes');
const { restaurantWaiterDevicePersistencePublicRouter } = require('./restaurant-waiter-device-persistence.public.routes');
const { restaurantTenantRealtimePublicRouter } = require('./restaurant-tenant-realtime.public.routes');
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
const { restaurantControlCenterResiliencePublicRouter } = require('./restaurant-control-center-resilience.public.routes');
const { installPaymentMethodsVisibilityRuntime } = require('./restaurant-payment-methods-visibility-browser.public.routes');
const { restaurantCashCompactV30PublicRouter, compactCashRuntime } = require('./restaurant-cash-compact-v30.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Canonical Restaurant public surfaces remain owned by the established shell:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// Payment Methods Visibility V2 only appends the tenant-owned payment configuration shortcut
// to Caja; it does not replace or fork the operational Restaurant shell.
function installCashCompactRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes('VANTIX_CASH_COMPACT_V30')) {
      const patched = `${source}\n;${compactCashRuntime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Cash-Compact', 'v30-dialogs');
    return originalSend(body);
  };
  return next();
}

// This root-mounted public router is evaluated before the generic /app HTML fallback.
// Keep the Super Core PWA manifest/service worker public and free of tenant/session data.
router.use(coreAdminPwaPublicRouter);
router.use(restaurantPublicRealtimePublisher);
router.use(restaurantQrPresenceRealtimePublicRouter);
router.use(restaurantQrOrderWaiterAlertPublicRouter);
router.use(restaurantWaiterDevicePersistencePublicRouter);
router.use(installCashCompactRuntime);
router.use(installPaymentMethodsVisibilityRuntime);
router.use(restaurantTenantRealtimePublicRouter);
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
router.use(restaurantControlCenterResiliencePublicRouter);
router.use(restaurantCashCompactV30PublicRouter);
router.use(legacyRestaurantPublicRouter);

module.exports = { restaurantPublicRouter: router, installCashCompactRuntime };
