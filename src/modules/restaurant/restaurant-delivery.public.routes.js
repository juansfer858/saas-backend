'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const router = express.Router();
const deliveryUi = path.join(__dirname, '../../web/restaurant-delivery-ui.js');
const deliveryCustomerAutofill = path.join(__dirname, '../../web/restaurant-delivery-customer-autofill-v83.js');

router.get('/app/restaurant-delivery-ui.js', async (_req, res, next) => {
  try {
    const [baseUi, customerAutofill] = await Promise.all([
      fs.promises.readFile(deliveryUi, 'utf8'),
      fs.promises.readFile(deliveryCustomerAutofill, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Delivery-Customer-Autofill', 'v83');
    res.type('application/javascript').send(`${baseUi}\n\n${customerAutofill}\n`);
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantDeliveryPublicRouter: router };
