const express = require('express');
const controller = require('./accounting.controller');
const { partidaDobleMiddleware } = require('../../middleware/partida-doble-middleware');

const router = express.Router();

router.get('/cuentas', controller.listAccounts);
router.post('/cuentas', controller.createAccount);
router.get('/asientos', controller.listJournals);
router.post('/asientos', partidaDobleMiddleware, controller.createJournal);

module.exports = { accountingRouter: router };
