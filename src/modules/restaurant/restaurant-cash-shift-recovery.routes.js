'use strict';

const express = require('express');
const identity = require('./restaurant-identity.service');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

router.get('/caja/turno-activo', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try {
    res.json({
      ok: true,
      data: await identity.cashShiftState(req.tenantId, req.userId)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantCashShiftRecoveryRouter: router };
