'use strict';

const express = require('express');
const { cashShiftState } = require('./restaurant-cash-shift-recovery.service');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

router.get('/caja/turno-activo', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try {
    res.json({
      ok: true,
      data: await cashShiftState(req.tenantId, req.userId)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantCashShiftRecoveryRouter: router };
