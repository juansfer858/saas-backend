'use strict';

const express = require('express');
require('./restaurant-pos-operational-mode');
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
const { installPosReceiptImmediateRuntime } = require('./restaurant-pos-receipt-immediate.public.routes');
const { restaurantCashCompactV30PublicRouter, compactCashRuntime } = require('./restaurant-cash-compact-v30.public.routes');
const { restaurantPublicRouter: legacyRestaurantPublicRouter } = require('./restaurant.public.routes.base');

const router = express.Router();

// Canonical Restaurant public surfaces remain owned by the established shell:
// /app/centro-de-control · operational-shell-v1 · restaurant-ui-v1
// restaurant-control-center.css · restaurant-control-center.js
// Administrative company identity belongs to /app/configuracion-avanzada, not to Centro de control.
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
// Installer V50 is public by design: it only serves the bootstrap. Tenant credentials
// are still requested/provisioned separately by the installer and are never embedded here.
router.use(publicInstallerRouter);
router.use(coreAdminPwaPublicRouter);
router.use(platformEdgeRolloutPublicRouter);
// Company identity is an Administration concern. This layer wraps only Configuración avanzada.
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
// V53 se instala sobre el asset Cloud antes de que el DOMContentLoaded del Centro
// de Control cree el pase local, para conservar el mismo origen que inició el flujo.
router.use(installRestaurantHybridLocalOriginV53);
router.use(installCashCollectDialogRuntime);
router.use(installPaymentMethodsVisibilityRuntime);
router.use(installRestaurantPaymentChainV43);
// V49 queda después de V43 y antes de V47 en la cadena de montaje para que su
// presentación por persona sea la última capa visual sobre el cobro individual.
router.use(installRestaurantIndividualCashV49);
// Se monta después de V43 para que su runtime quede antes de V43 en el asset final:
// remapea la lectura de clientes al endpoint acotado y hace autoritativo Crédito.
router.use(installRestaurantCreditCheckoutV47);
router.use(installRestaurantCashCloseBreakdownV45);
router.use(installWaiterVisitCodeRuntime);
router.use(installWaiterCallPcRuntime);
// V55 envuelve las superficies antes de V54: así el cliente espera la habilitación
// y, una vez abierta la mesa, V54 entrega el pase del teléfono sin PIN y el pedido continúa.
router.use(installRestaurantTableEnableV55);
router.use(installPrintTemplateEditorRuntime);
router.use(installPosReceiptImmediateRuntime);
router.use(restaurantTenantRealtimePublicRouter);
router.use(restaurantElectronicPaymentPublicRouter);
router.use(restaurantWaiterCallRefreshPublicRouter);
router.use(restaurantWaiterCallUnifiedPublicRouter);
router.use(restaurantWaiterCallPublicRouter);
router.use(restaurantMenuImportPublicRouter);
router.use(restaurantTableEnableV55PublicRouter);
// V54 queda como autorización automática del teléfono DESPUÉS de que V55 haya exigido
// una sesión de mesa aprobada por personal. No vuelve el PIN de cuatro dígitos.
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
