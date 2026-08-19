const express = require('express');
const controller = require('./treasury.controller');

const router = express.Router();

router.get('/cajas-bancos', controller.listCajaBanco);
router.post('/cajas-bancos', controller.createCajaBanco);
router.delete('/cajas-bancos/:id', controller.deactivateCajaBanco);
router.post('/cajas-bancos/:cajaBancoId/abrir', controller.openCashSession);
router.post('/turnos/:sessionId/cerrar', controller.closeCashSession);

router.get('/cartera', controller.listCartera);
router.get('/pagos', controller.listPayments);
router.post('/pagos', controller.registerPayment);

module.exports = { treasuryRouter: router };
