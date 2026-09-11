'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const router = express.Router();
const deliveryUi = path.join(__dirname, '../../web/restaurant-delivery-ui.js');
const deliveryCustomerAutofill = path.join(__dirname, '../../web/restaurant-delivery-customer-autofill-v83.js');
const deliverySendProduction = path.join(__dirname, '../../web/restaurant-delivery-send-production-v86.js');
const deliveryMenuGuard = path.join(__dirname, '../../web/restaurant-delivery-menu-guard-v88.js');
const deliveryMenuCompact = path.join(__dirname, '../../web/restaurant-delivery-menu-compact-v89.js');
const deliverySharedMenu = path.join(__dirname, '../../web/restaurant-delivery-shared-menu-v90.js');
const deliveryOrdersMenu = path.join(__dirname, '../../web/restaurant-delivery-orders-menu-v91.js');
const deliveryLazyMenu = path.join(__dirname, '../../web/restaurant-delivery-lazy-menu-v92.js');
const deliveryOrdersCompact = path.join(__dirname, '../../web/restaurant-delivery-orders-compact-v93.js');

router.get('/app/restaurant-delivery-menu-guard-v88.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Menu-Guard', 'v88');
  res.type('application/javascript').sendFile(deliveryMenuGuard);
});

router.get('/app/restaurant-delivery-menu-compact-v89.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Menu-Compact', 'v89');
  res.type('application/javascript').sendFile(deliveryMenuCompact);
});

router.get('/app/restaurant-delivery-shared-menu-v90.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Shared-Menu', 'v90');
  res.type('application/javascript').sendFile(deliverySharedMenu);
});

router.get('/app/restaurant-delivery-orders-menu-v91.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Orders-Menu', 'v91');
  res.type('application/javascript').sendFile(deliveryOrdersMenu);
});

router.get('/app/restaurant-delivery-lazy-menu-v92.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Lazy-Menu', 'v92');
  res.type('application/javascript').sendFile(deliveryLazyMenu);
});

router.get('/app/restaurant-delivery-orders-compact-v93.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-VantixGC-Restaurant-Delivery-Orders-Compact', 'v93');
  res.type('application/javascript').sendFile(deliveryOrdersCompact);
});

router.get('/app/restaurant-delivery-ui.js', async (_req, res, next) => {
  try {
    const [baseUi, customerAutofill, sendProduction] = await Promise.all([
      fs.promises.readFile(deliveryUi, 'utf8'),
      fs.promises.readFile(deliveryCustomerAutofill, 'utf8'),
      fs.promises.readFile(deliverySendProduction, 'utf8')
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Restaurant-Delivery-Customer-Autofill', 'v83');
    res.set('X-VantixGC-Restaurant-Delivery-Send-Production', 'v86');
    res.set('X-VantixGC-Restaurant-Delivery-Menu-Active', 'v93');
    res.type('application/javascript').send(`${baseUi}\n\n${customerAutofill}\n\n${sendProduction}\n`);
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantDeliveryPublicRouter: router };
