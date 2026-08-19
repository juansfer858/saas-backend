const express = require('express');
const controller = require('./core-integration.controller');

const router = express.Router();

router.get('/parametrizacion-contable', controller.getParametrization);
router.patch('/parametrizacion-contable', controller.updateParametrization);

router.post('/inventario/ajustes', controller.createInventoryAdjustment);
router.post('/tesoreria/transferencias', controller.transferOwnFunds);
router.post('/tesoreria/gastos-directos', controller.directExpense);
router.post('/tesoreria/aplicaciones-multiples', controller.applyMultiplePayments);

router.get('/cartera/resumen', controller.carteraSummary);
router.get('/cartera/terceros/:id/auxiliar', controller.thirdPartyAccountingDetail);

router.get('/terceros/:id/operacion', controller.getThirdPartyExtended);
router.patch('/terceros/:id/operacion', controller.updateThirdPartyExtended);

module.exports = { coreIntegrationRouter: router };
