const express = require('express');
const { extractTenantBySubdomain } = require('../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../middleware/auth-middleware');
const { restaurantPublicDemoGuard } = require('../middleware/restaurant-public-demo-guard');
const { enforceTenantPermissions } = require('../middleware/require-permission');
const { restaurantBusinessAuditC85 } = require('../middleware/restaurant-business-audit-c85');
const { tenantRealtimeRouter, tenantRealtimeMutationMiddleware } = require('../modules/realtime/tenant-realtime.routes');
const { userRouter } = require('../modules/users/user.routes');
const { thirdPartyRouter } = require('../modules/third-parties/third-party.routes');
const { inventoryRouter } = require('../modules/inventory/inventory.routes');
const { treasuryRouter } = require('../modules/treasury/treasury.routes');
const { treasuryRecentReceiptsRouter } = require('../modules/treasury/treasury-recent-receipts.routes');
const { paymentRouter } = require('../modules/treasury/payment.routes');
const { commercialRouter } = require('../modules/commercial/commercial.routes');
const { accountingRouter } = require('../modules/accounting/accounting.routes');
const { consumptionRouter } = require('../modules/consumption/consumption.routes');
const { dianRouter } = require('../modules/platform/dian/dian.routes');
const { payrollRouter } = require('../modules/platform/payroll/payroll.routes');
const { printingRouter } = require('../modules/platform/printing/printing.routes');
const { rbacRouter } = require('../modules/platform/rbac/rbac.routes');
const { edgeTenantRouter } = require('../modules/edge/edge.routes');
const { edgeTenantUpdateGuard } = require('../modules/edge/edge-tenant-update-guard');
const { edgeHybridLocalOriginV53Router } = require('../modules/edge/edge-hybrid-local-origin-v53.routes');
const { notificationsRouter } = require('../modules/notifications/notifications.routes');
const { notificationPushV65Router } = require('../modules/notifications/push-v65.routes');
const { metaTechRouter } = require('../modules/notifications/meta-tech.routes');
const { restaurantRouter } = require('../modules/restaurant/restaurant.routes');
const { restaurantPrintTemplateRouter } = require('../modules/restaurant/restaurant-print-template.routes');
const { restaurantCashShiftRecoveryRouter } = require('../modules/restaurant/restaurant-cash-shift-recovery.routes');
const { restaurantVisitPaymentsRouter } = require('../modules/restaurant/restaurant-visit-payments.routes');
const { restaurantCreditPaymentRouter, restaurantCreditRollbackMiddleware } = require('../modules/restaurant/restaurant-credit-payment.routes');
const { restaurantCreditCustomerRouter } = require('../modules/restaurant/restaurant-credit-customer.routes');
const { restaurantMenuImportRouter } = require('../modules/restaurant/restaurant-menu-import.routes');
const { restaurantWaiterCallUnifiedRouter } = require('../modules/restaurant/restaurant-waiter-call-unified.routes');
const { restaurantWaiterCallRouter } = require('../modules/restaurant/restaurant-waiter-call.routes');
const { restaurantWaiterDeviceRouter } = require('../modules/restaurant/restaurant-waiter-device.routes');
const { restaurantDeliveryRouter } = require('../modules/restaurant/restaurant-delivery.routes');
const { restaurantEmployeeWorkRouter } = require('../modules/restaurant/restaurant-employee-work.routes');
const { restaurantTestDataResetV66Router } = require('../modules/restaurant/restaurant-test-data-reset-v66.routes');
const { restaurantTestDataResetV68Router } = require('../modules/restaurant/restaurant-test-data-reset-v68.routes');
const { restaurantTableLiveDetailV67Router } = require('../modules/restaurant/restaurant-table-live-detail-v67.routes');
const { restaurantV2TableMoveRouter } = require('../modules/restaurant/restaurant-v2-table-move.routes');
const { restaurantV2TableOpenRequestRouter } = require('../modules/restaurant/restaurant-v2-table-open-request.routes');
const { restaurantV2OrdersRouter } = require('../modules/restaurant/restaurant-v2-orders.routes');
const { restaurantV2CashRouter } = require('../modules/restaurant/restaurant-v2-cash.routes');
const { restaurantV2SplitRouter } = require('../modules/restaurant/restaurant-v2-split.routes');
const { restaurantV2KdsRouter } = require('../modules/restaurant/restaurant-v2-kds.routes');
const { restaurantV2PilotRouter } = require('../modules/restaurant/restaurant-v2-pilot.routes');
const { restaurantV2CutoverRouter, restaurantV2CutoverPilotGuard } = require('../modules/restaurant/restaurant-v2-cutover.routes');
const { restaurantV1RetirementP11Router, restaurantV1RetirementCutoverGuard } = require('../modules/restaurant/restaurant-v1-retirement-p11.routes');
const { restaurantSelfServiceTenantRouter } = require('../modules/self-service/restaurant-self-service.routes');
const { installRestaurantRbac } = require('../modules/restaurant/restaurant.rbac');

installRestaurantRbac();

const router = express.Router();

router.use(extractTenantBySubdomain);
router.use(authMiddleware);
router.use(restaurantPublicDemoGuard);
router.use(enforceTenantPermissions);
router.use(restaurantBusinessAuditC85);

router.use(tenantRealtimeMutationMiddleware);
router.use('/realtime', tenantRealtimeRouter);

router.use('/autoservicio', restaurantSelfServiceTenantRouter);
router.use('/usuarios', userRouter);
router.use('/terceros', thirdPartyRouter);
router.use('/inventario', inventoryRouter);
router.use('/tesoreria/recaudos-recientes', treasuryRecentReceiptsRouter);
router.use('/tesoreria', treasuryRouter);
router.use('/pagos', paymentRouter);
router.use('/comercial', commercialRouter);
router.use('/contabilidad', accountingRouter);
router.use('/consumo', consumptionRouter);
router.use('/dian', dianRouter);
router.use('/nomina', payrollRouter);
router.use('/impresion', printingRouter);
router.use('/seguridad', rbacRouter);
router.use('/edge', edgeHybridLocalOriginV53Router);
router.use('/edge', edgeTenantUpdateGuard, edgeTenantRouter);
router.use('/notificaciones/push-v65', notificationPushV65Router);
router.use('/notificaciones', metaTechRouter);
router.use('/notificaciones', notificationsRouter);
router.use('/restaurante', restaurantPrintTemplateRouter);
router.use('/restaurante', restaurantMenuImportRouter);
router.use('/restaurante', restaurantVisitPaymentsRouter);
router.use('/restaurante', restaurantCreditCustomerRouter);
router.use('/restaurante', restaurantCreditPaymentRouter);
router.use('/restaurante', restaurantWaiterCallUnifiedRouter);
router.use('/restaurante', restaurantWaiterCallRouter);
router.use('/restaurante', restaurantWaiterDeviceRouter);
router.use('/restaurante', restaurantDeliveryRouter);
router.use('/restaurante', restaurantEmployeeWorkRouter);
router.use('/restaurante', restaurantCashShiftRecoveryRouter);
router.use('/restaurante', restaurantTableLiveDetailV67Router);
router.use('/restaurante', restaurantV2TableMoveRouter);
// QR Cliente puede solicitar apertura sin abrir la mesa por sí mismo. Mesas/Pedidos V2
// consumen esta cola y un usuario con MESAS.CREAR confirma la apertura real.
router.use('/restaurante', restaurantV2TableOpenRequestRouter);
// V2 P3 orders is opt-in and standalone. V1 routes keep their original waiter scope
// and billing semantics while this API enables shared-floor reinforcement + optional persons.
router.use('/restaurante', restaurantV2OrdersRouter);
// V2 P4 Caja owns its API independently. It closes the same real sale/session but never
// enters the legacy V1 cash UI rewrite chain and never makes DIAN a mandatory gate.
router.use('/restaurante', restaurantV2CashRouter);
// V2 P5 Division is a separate settlement surface. It uses the same sale/session and
// real Treasury/Accounting contracts while keeping the legacy Restaurant routes intact.
router.use('/restaurante', restaurantV2SplitRouter);
// V2 P6 KDS is push/realtime-driven and reuses the canonical command state machine.
// It remains opt-in and does not alter legacy KDS/device routes.
router.use('/restaurante', restaurantV2KdsRouter);
// P11 keeps P10 active while V1 is retired from normal operation. Restore P10
// compatibility first if a technical rollback needs to disable the cutover.
router.use('/restaurante', restaurantV1RetirementCutoverGuard);
// P10 prevents an active cutover from being left without its P9 safety envelope.
router.use('/restaurante', restaurantV2CutoverPilotGuard);
// P9 controls pilot enrollment per tenant. P10 consumes that proven state before it
// may switch canonical device entrypoints to V2 for this tenant only.
router.use('/restaurante', restaurantV2PilotRouter);
router.use('/restaurante', restaurantV2CutoverRouter);
router.use('/restaurante', restaurantV1RetirementP11Router);
router.use('/restaurante', restaurantTestDataResetV68Router);
router.use('/restaurante', restaurantTestDataResetV66Router);
router.use('/restaurante', restaurantRouter);
router.use(restaurantCreditRollbackMiddleware);

module.exports = { coreRouter: router };
