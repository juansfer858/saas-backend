const express = require('express');
const { extractTenantBySubdomain } = require('../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../middleware/auth-middleware');
const { enforceTenantPermissions } = require('../middleware/require-permission');
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
const { restaurantTableLiveDetailV67Router } = require('../modules/restaurant/restaurant-table-live-detail-v67.routes');
const { restaurantSelfServiceTenantRouter } = require('../modules/self-service/restaurant-self-service.routes');
const { installRestaurantRbac } = require('../modules/restaurant/restaurant.rbac');

installRestaurantRbac();

const router = express.Router();

router.use(extractTenantBySubdomain);
router.use(authMiddleware);
router.use(enforceTenantPermissions);

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
// V53 debe resolver el pase de retorno antes del router Edge canónico para conservar
// exactamente el origen local autorizado (127.0.0.1/localhost o la IP LAN reportada).
router.use('/edge', edgeHybridLocalOriginV53Router);
router.use('/edge', edgeTenantUpdateGuard, edgeTenantRouter);
// V65 extiende el Core de Notificaciones con dispositivos Push. Se monta antes
// del router histórico WhatsApp/SMS para mantener el canal FCM aislado y reversible.
router.use('/notificaciones/push-v65', notificationPushV65Router);
router.use('/notificaciones', metaTechRouter);
router.use('/notificaciones', notificationsRouter);
router.use('/restaurante', restaurantPrintTemplateRouter);
router.use('/restaurante', restaurantMenuImportRouter);
router.use('/restaurante', restaurantVisitPaymentsRouter);
// Checkout de crédito: permite al cajero listar/crear únicamente clientes para
// la operación de cartera, sin otorgar acceso administrativo completo a Terceros.
router.use('/restaurante', restaurantCreditCustomerRouter);
// Debe ejecutarse antes del router base: para crédito enlaza cliente/plazo/cupo
// al borrador y luego deja que la ruta canónica /mesas/:id/cerrar haga emisión,
// inventario, contabilidad, cartera, cierre de mesa e impresión.
router.use('/restaurante', restaurantCreditPaymentRouter);
router.use('/restaurante', restaurantWaiterCallUnifiedRouter);
router.use('/restaurante', restaurantWaiterCallRouter);
router.use('/restaurante', restaurantWaiterDeviceRouter);
router.use('/restaurante', restaurantDeliveryRouter);
router.use('/restaurante', restaurantEmployeeWorkRouter);
router.use('/restaurante', restaurantCashShiftRecoveryRouter);
// V67 agrega lectura operativa completa por mesa y permite descartar únicamente
// una apertura totalmente vacía. No reutiliza el cierre de venta/cobro.
router.use('/restaurante', restaurantTableLiveDetailV67Router);
// V66 sólo existe para el tenant de demostración y requiere permiso de Administración.
// Se monta antes del router base para que la limpieza destructiva quede aislada y reversible.
router.use('/restaurante', restaurantTestDataResetV66Router);
router.use('/restaurante', restaurantRouter);
// Sólo procesa errores de un cierre a crédito previamente preparado. Si el cierre
// canónico falló, restaura el BORRADOR antes de continuar al error handler global.
router.use(restaurantCreditRollbackMiddleware);

module.exports = { coreRouter: router };
