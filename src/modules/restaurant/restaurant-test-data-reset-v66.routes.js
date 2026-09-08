'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const reset = require('./restaurant-test-data-reset-v66.service');

const router = express.Router();

router.get('/limpieza-pruebas/v66/resumen', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await reset.summary(req.tenantId) });
  } catch (error) {
    next(error);
  }
});

router.post('/limpieza-pruebas/v66/ejecutar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const data = await reset.execute(req.tenantId, req.userId, req.body?.confirmation);
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = { restaurantTestDataResetV66Router: router };
