const express = require('express');
const { extractTenantBySubdomain } = require('../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../middleware/auth-middleware');
const { enforceTenantPermissions } = require('../middleware/require-permission');
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
const { notificationsRouter } = require('../modules/notifications/notifications.routes');
const { metaTechRouter } = require('../modules/notifications/meta-tech.routes');
const { restaurantRouter } = require('../modules/restaurant/restaurant.routes');
const { restaurantVisitPaymentsRouter } = require('../modules/restaurant/restaurant-visit-payments.routes');
const { restaurantSelfServiceTenantRouter } = require('../modules/self-service/restaurant-self-service.routes');
require('../modules/restaurant/restaurant-draft-fix');
const { installRestaurantRbac } = require('../modules/restaurant/restaurant.rbac');

installRestaurantRbac();

const router = express.Router();

router.use(extractTenantBySubdomain);
router.use(authMiddleware);
router.use(enforceTenantPermissions);

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
router.use('/edge', edgeTenantRouter);
router.use('/notificaciones', metaTechRouter);
router.use('/notificaciones', notificationsRouter);
router.use('/restaurante', restaurantRouter);
router.use('/restaurante', restaurantVisitPaymentsRouter);

module.exports = { coreRouter: router };
