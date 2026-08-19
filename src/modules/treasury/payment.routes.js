const express = require('express');
const controller = require('./treasury.controller');

const router = express.Router();

router.get('/', controller.listPayments);
router.post('/', controller.registerPayment);

module.exports = { paymentRouter: router };
