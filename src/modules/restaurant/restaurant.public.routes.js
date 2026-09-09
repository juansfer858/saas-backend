'use strict';

const express = require('express');
require('./restaurant-pos-operational-mode');
const { restaurantOperationalV2PreviewPublicRouter } = require('./restaurant-operational-v2-preview.public.routes');
const { coreAdminPwaPublicRouter } = require('../platform/core-admin-pwa.public.routes');
const { publicInstallerRouter } = require('../public-installer/public-installer.routes');
const { platformEdgeRolloutPublicRouter } = require('../platform/saas/platform-edge-rollout.public.routes');
const { restaurantEdgeManagedPublicRouter } = require('./restaurant-edge-managed.public.routes');
const { restaurantPublicRealtimePublisher } = require('./restaurant-public-realtime-publisher');
const { restaurantQrPresenceRealtimePublicRouter } = require('./restaurant-qr-presence-realtime.public.routes');
const { restaurantQrOrderWaiterAlertPublicRouter } = require('./restaurant-qr-order-waiter-alert.public.routes');
const { restaurantWaiterDevicePersistencePublicRouter } = require('./restaurant-waiter-device-persistence.public.routes');
const { restaurantMenuSurfaceSyncPublicRouter, installMenuSurfaceSyncRuntime } = require('./restaurant-menu-surface-sync.public.routes');
const { installQrCategoryStableRuntime } = require('./restaurant-qr-category-stable.public.routes');
const { installQrOrderTouchLock } = require('./restaurant-qr-order-touch-lock.public.routes');
const { installQrTrackingTouchLock } = require('./restaurant-qr-tracking-touch-lock.public.routes');
const { installQrTableHeaderRuntime } = require('./restaurant-qr-table-header.public.routes');
const { installRestaurantQrPrintRollV48 } = require('./restaurant-qr-print-roll-v48.public.routes');
const { installRestaurantIndividualCashV49 } = require('./restaurant-individual-cash-v49.public.routes');
const { installRestaurantHybridLocalOriginV53 } = require('./restaurant-hybrid-local-origin-v53.public.routes');
const { restaurantQrDirectTestV54PublicRouter, installRestaurantQrDirectTestV54 } = require('./restaurant-qr-direct-test-v54.public.routes');
const { restaurantTableEnableV55PublicRouter, installRestaurantTableEnableV55 } = require('./restaurant-table-enable-v55.public.routes');
const { installRestaurantTableEnableV56 } = require('./restaurant-table-enable-v56.public.routes');
const { installRestaurantGlobalProductSearchV57 } = require('./restaurant-global-product-search-v57.public.routes');
const { installRestaurantAccountAttentionV58 } = require('./restaurant-account-attention-v58.public.routes');
const { installRestaurantQrProductNotesV61 } = require('./restaurant-qr-product-notes-v61.public.routes');
const { installRestaurantCashCloseMethodsV62 } = require('./restaurant-cash-close-methods-v62.public.routes');
const { restaurantPushV65PublicRouter, installRestaurantPushV65 } = require('./restaurant-push-v65.public.routes');
const { installRestaurantTableLiveDetailV67 } = require('./restaurant-table-live-detail-v67.public.routes');
const { installRestaurantJointSplitV73 } = require('./restaurant-joint-split-v73.public.routes');
const { installRestaurantWaiterCloseEmptyV74 } = require('./restaurant-waiter-close-empty-v74.public.routes');
const { restaurantKdsReliabilityPublicRouter, installKdsReliabilityRuntime } = require('./restaurant-kds-reliability.public.routes');
const { restaurantKdsWindowsPrinterAssetPublicRouter, installKdsWindowsPrinterAsset } = require('./restaurant-kds-windows-printer-asset.public.routes');
const { restaurantTenantRealtimePublicRouter } = require('./restaurant-tenant-realtime.public.routes');
const { restaurantElectronicPaymentPublicRouter } = require('./restaurant-electronic-payment.public.routes');
const { restaurantWaiterCallRefreshPublicRouter } = require('./restaurant-waiter-call-refresh.public.routes');
const { restaurantWaiterCallUnifiedPublicRouter, installWaiterCallPcRuntime } = require('./restaurant-waiter-call-unified.public.routes');
const { restaurantWaiterCallPublicRouter } = require('./restaurant-waiter-call.public.routes');
const { restaurantMenuImportPublicRouter } = require('./restaurant-menu-import.public.routes');
const { restaurantVisitPublicRouter } = require('./restaurant-visit.public.routes');
const { restaurantClientTrackingPublicRouter } = require('./restaurant-client-tracking.public.routes');
const { restaurantWaiterDevicePublicRouter } = require('./restaurant-waiter-device.public.routes');
const { restaurantDeliveryPublicRouter } = require('./restaurant-delivery.public.routes');
const { restaurantEmployeesPublicRouter } = require('./restaurant-employees.public.routes');
const { restaurantEmployeeWorkPublicRouter } = require('./restaurant-employee-work.public.routes');
const { restaurantControlCenterResiliencePublicRouter } = require('./restaurant-control-center-resilience.public.routes');
const { restaurantCompanyAdminAdvancedPublicRouter, installCompanyAdminAdvancedAsset } = require('./restaurant-company-admin-advanced.public.routes');
const { installPaymentMethodsVisibilityRuntime } = require('./restaurant-payment-methods-visibility-browser.public.routes');
const { installRestaurantPaymentChainV43 } = require('./restaurant-payment-chain-v43.public.routes');
const { installRestaurantCreditCheckoutV47 } = require('./restaurant-credit-checkout-v47.public.routes');
const { installRestaurantCashCloseBreakdownV45 } = require('./restaurant-cash-close-breakdown-v45.public.routes');
const { installCashShiftRecoveryRuntime } = require('./restaurant-cash-shift-recovery.public.routes');
const { installCashCollectDialogRuntime } = require('./restaurant-cash-collect-dialog.public.routes');
const { installWaiterVisitCodeRuntime } = require('./restaurant-waiter-visit-code.public.routes');
const { installPrintTemplateEditorRuntime } = require('./restaurant-print-template-ui.public.routes');
const { installRestaurantPosPrintChoiceV75 } = require('./restaurant-pos-print-choice-v75.public.routes');
const { installPosReceiptImmediateRuntime } = require('./restaurant-pos-receipt-immediate.public.routes');
const { restaurantCashCompactV30PublicRouter, compactCashRuntime } = require('./restaurant-cash-compact-v30.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Canonical Restaurant V1 ownership remains explicit for compatibility contracts:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// V2 is handled before every legacy response wrapper. If this router answers,
// the request never enters source-rewriting layers from Restaurant V1.
router.use(restaurantOperationalV2PreviewPublicRouter);

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

router.use(publicInstallerRouter);
router.use(coreAdminPwaPublicRouter);
router.use(platformEdgeRolloutPublicRouter);
router.use(restaurantPushV65PublicRouter);
router.use(installRestaurantPushV65);
router.use(installRestaurantTableLiveDetailV67);
router.use(installRestaurantJointSplitV73);
router.use(installRestaurantWaiterCloseEmptyV74);
router.use(installRestaurantCashCloseMethodsV62);
router.use(installRestaurantQrProductNotesV61);
router.use(installRestaurantAccountAttentionV58);
router.use(installRestaurantGlobalProductSearchV57);
router.use(installRestaurantTableEnableV56);
router.use(installCompanyAdminAdvancedAsset);
router.use(restaurantCompanyAdminAdvancedPublicRouter);
router.use(restaurantEdgeManagedPublicRouter);
router.use(restaurantKdsReliabilityPublicRouter);
router.use(restaurantKdsWindowsPrinterAssetPublicRouter);
router.use(installKdsWindowsPrinterAsset);
router.use(installQrCategoryStableRuntime);
router.use(installQrOrderTouchLock);
router.use(installQrTrackingTouchLock);
router.use(installQrTableHeaderRuntime);
router.use(installRestaurantQrPrintRollV48);
router.use(installKdsReliabilityRuntime);
router.use(restaurantMenuSurfaceSyncPublicRouter);
router.use(installMenuSurfaceSyncRuntime);
router.use(restaurantPublicRealtimePublisher);
router.use(restaurantQrPresenceRealtimePublicRouter);
router.use(restaurantQrOrderWaiterAlertPublicRouter);
router.use(restaurantWaiterDevicePersistencePublicRouter);
router.use(installCashShiftRecoveryRuntime);
router.use(installCashCompactRuntime);
router.use(installRestaurantHybridLocalOriginV53);
router.use(installCashCollectDialogRuntime);
router.use(installPaymentMethodsVisibilityRuntime);
router.use(installRestaurantPaymentChainV43);
router.use(installRestaurantIndividualCashV49);
router.use(installRestaurantCreditCheckoutV47);
router.use(installRestaurantCashCloseBreakdownV45);
router.use(installWaiterVisitCodeRuntime);
router.use(installWaiterCallPcRuntime);
router.use(installRestaurantTableEnableV55);
router.use(installPrintTemplateEditorRuntime);
router.use(installRestaurantPosPrintChoiceV75);
router.use(installPosReceiptImmediateRuntime);
router.use(restaurantTenantRealtimePublicRouter);
router.use(restaurantElectronicPaymentPublicRouter);
router.use(restaurantWaiterCallRefreshPublicRouter);
router.use(restaurantWaiterCallUnifiedPublicRouter);
router.use(restaurantWaiterCallPublicRouter);
router.use(restaurantMenuImportPublicRouter);
router.use(restaurantTableEnableV55PublicRouter);
router.use(installRestaurantQrDirectTestV54);
router.use(restaurantQrDirectTestV54PublicRouter);
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
