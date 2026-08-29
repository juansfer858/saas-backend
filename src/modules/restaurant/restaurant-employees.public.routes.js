'use strict';

const path = require('node:path');
const express = require('express');

const router = express.Router();
const employeesUi = path.join(__dirname, '../../web/restaurant-employees-ui.js');

router.get('/app/restaurant-employees-ui.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').sendFile(employeesUi);
});

module.exports = { restaurantEmployeesPublicRouter: router };
