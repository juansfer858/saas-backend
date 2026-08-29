'use strict';

const path = require('node:path');
const express = require('express');

const router = express.Router();
const deliveryUi = path.join(__dirname, '../../web/restaurant-delivery-ui.js');

router.get('/app/restaurant-delivery-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(deliveryUi);
});

module.exports = { restaurantDeliveryPublicRouter: router };
