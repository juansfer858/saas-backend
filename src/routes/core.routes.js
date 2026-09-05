const express = require('express');
const { extractTenantBySubdomain } = require('../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../middleware/auth-middleware');
const { enforceTenantPermissions } = require('../middleware/require-permission');
const { tenantRealtimeRouter, tenantRealtimeMutationMiddleware } = require('../modules/realtime/tenant-realtime.routes');
const { userRouter } = require('../modules/users/user.routes');
const { thirdPartyRouter } = require('../modules/third-parties/third-party.routes');
const { inventoryRouter } = require('../modules/inventory/inventory.routes');
const { treasuryRouter } = require('../modules/treasury/treasury.routes');
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
const { notificationsRouter } = require('../modules/notifications/notifications.routes');
const { metaTechRouter } = require('../modules/notifications/meta-tech.routes');
const { restaurantRouter } = require('../modules/restaurant/restaurant.routes');
const { restaurantCashShiftRecoveryRouter } = require('../modules/restaurant/restaurant-cash-shift-recovery.routes');
const { restaurantVisitPaymentsRouter } = require('../modules/restaurant/restaurant-visit-payments.routes');
const { restaurantMenuImportRouter } = require('../modules/restaurant/restaurant-menu-import.routes');
const { restaurantWaiterCallRouter } = require('../modules/restaurant/restaurant-waiter-call.routes');
const { restaurantWaiterDeviceRouter } = require('../modules/restaurant/restaurant-waiter-device.routes');
const { restaurantDeliveryRouter } = require('../modules/restaurant/restaurant-delivery.routes');
const { restaurantEmployeeWorkRouter } = require('../modules/restaurant/restaurant-employee-work.routes');
const { restaurantSelfServiceTenantRouter } = require('../modules/self-service/restaurant-self-service.routes');
const { installRestaurantRbac } = require('../modules/restaurant/restaurant.rbac');

installRestaurantRbac();

const router = express.Router();

router.use(extractTenantBySubdomain);
router.use(authMiddleware);
router.use(enforceTenantPermissions);

// Un único bus por tenant enlaza Restaurante y Super Core. El middleware publica sólo
// después de una respuesta mutante exitosa, por lo que los consumidores nunca recargan
// antes de que la transacción haya terminado.
router.use(tenantRealtimeMutationMiddleware);
router.use('/realtime', tenantRealtimeRouter);

router.use('/autoservicio', restaurantSelfServiceTenantRouter);
router.use('/usuarios', userRouter);
router.use('/terceros', thirdPartyRouter);
router.use('/inventario', inventoryRouter);
router.use('/tesoreria', treasuryRouter);
router.use('/pagos', paymentRouter);
router.use('/comercial', commercialRouter);
router.use('/contabilidad', accountingRouter);
router.use('/consumo', consumptionRouter);
router.use('/dian', dianRouter);
router.use('/nomina', payrollRouter);
router.use('/impresion', printingRouter);
router.use('/seguridad', rbacRouter);
router.use('/edge', edgeTenantUpdateGuard, edgeTenantRouter);
router.use('/notificaciones', metaTechRouter);
router.use('/notificaciones', notificationsRouter);
// Extensions first so they can add isolated Restaurant capabilities while every other
// endpoint falls through unchanged to the proven base router.
router.use('/restaurante', restaurantMenuImportRouter);
router.use('/restaurante', restaurantVisitPaymentsRouter);
router.use('/restaurante', restaurantWaiterCallRouter);
router.use('/restaurante', restaurantWaiterDeviceRouter);
router.use('/restaurante', restaurantDeliveryRouter);
router.use('/restaurante', restaurantEmployeeWorkRouter);
router.use('/restaurante', restaurantCashShiftRecoveryRouter);
router.use('/restaurante', restaurantRouter);

module.exports = { coreRouter: router };
