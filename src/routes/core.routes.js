const express = require('express');
const { extractTenantBySubdomain } = require('../middleware/extract-tenant-by-subdomain');
const { authMiddleware } = require('../middleware/auth-middleware');
const { userRouter } = require('../modules/users/user.routes');
const { thirdPartyRouter } = require('../modules/third-parties/third-party.routes');
const { inventoryRouter } = require('../modules/inventory/inventory.routes');
const { treasuryRouter } = require('../modules/treasury/treasury.routes');
const { paymentRouter } = require('../modules/treasury/payment.routes');
const { commercialRouter } = require('../modules/commercial/commercial.routes');
const { accountingRouter } = require('../modules/accounting/accounting.routes');
const { coreIntegrationRouter } = require('../modules/integration/core-integration.routes');

const router = express.Router();

router.use(extractTenantBySubdomain);
router.use(authMiddleware);

router.use('/usuarios', userRouter);
router.use('/terceros', thirdPartyRouter);
router.use('/inventario', inventoryRouter);
router.use('/tesoreria', treasuryRouter);
router.use('/pagos', paymentRouter);
router.use('/comercial', commercialRouter);
router.use('/contabilidad', accountingRouter);
router.use('/integracion', coreIntegrationRouter);

module.exports = { coreRouter: router };
