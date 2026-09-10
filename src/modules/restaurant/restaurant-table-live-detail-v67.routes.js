'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-table-live-detail-v67.service');

const router = express.Router();

router.get('/mesas/:id/detalle-v67', requirePermission('MESAS.VER'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.liveDetail(req.tenantId, req.user, req.params.id) });
  } catch (error) { next(error); }
});

router.post(
  '/mesas/:id/borrador/items/:itemId/retirar-v20',
  requirePermission('MESAS.EDITAR'),
  requirePermission('PEDIDOS.CREAR'),
  async (req, res, next) => {
    try {
      res.json({ ok: true, data: await service.removeDraftItemFromControlCenter(req.tenantId, req.user, req.params.id, req.params.itemId) });
    } catch (error) { next(error); }
  }
);

router.post('/mesas/:id/cancelar-apertura-v67', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.cancelEmptyOpening(req.tenantId, req.user, req.params.id) });
  } catch (error) { next(error); }
});

module.exports = { restaurantTableLiveDetailV67Router: router };
