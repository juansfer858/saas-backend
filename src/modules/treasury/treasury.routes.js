const express = require('express');
const controller = require('./treasury.controller');
const recentCollections = require('./treasury-recent-collections.service');

const router = express.Router();

router.get('/cajas-bancos', controller.listCajaBanco);
router.post('/cajas-bancos', controller.createCajaBanco);
router.patch('/cajas-bancos/:id/cuenta-contable', controller.setCajaBancoAccounting);
router.delete('/cajas-bancos/:id', controller.deactivateCajaBanco);
router.post('/cajas-bancos/:cajaBancoId/abrir', controller.openCashSession);
router.post('/turnos/:sessionId/cerrar', controller.closeCashSession);

router.get('/cartera', controller.listCartera);
router.get('/cartera/antiguedad', controller.carteraAging);
router.get('/cartera/conciliacion-contable', controller.carteraAccountingReconciliation);
router.get('/cartera/terceros/:terceroId', controller.carteraThirdPartyDetail);
router.get('/recaudos-recientes', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await recentCollections.listRecentCollections(req.tenantId, { limit: req.query.limit }) });
  } catch (error) { next(error); }
});
router.get('/pagos', controller.listPayments);
router.post('/pagos', controller.registerPayment);
router.post('/pagos/aplicar-multiples', controller.registerPaymentBatch);
router.post('/transferencias', controller.transferOwnFunds);
router.post('/gastos-directos', controller.directExpense);

module.exports = { treasuryRouter: router };
