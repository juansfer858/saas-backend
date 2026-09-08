'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-admin-item-correction-v76.service');

const router = express.Router();

router.post('/admin-correcciones-v76/items/:itemId/quitar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const data = await service.removeItem(req.tenantId, req.user, req.params.itemId, req.body || {});
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

router.get('/admin-correcciones-v76/ventas/:saleId/historial', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const data = await service.listCorrections(req.tenantId, req.params.saleId, req.query.limit);
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});

module.exports = { restaurantAdminItemCorrectionV76Router: router };
