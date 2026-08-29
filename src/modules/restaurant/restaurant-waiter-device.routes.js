'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./restaurant-waiter-device.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de dispositivo inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const pairingSchema = z.object({
  userId: z.string().uuid(),
  deviceName: z.string().trim().max(80).optional().nullable()
});

router.get('/dispositivos-mesero', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listDevices(req.tenantId) }); } catch (error) { next(error); }
});

router.post('/dispositivos-mesero/vinculo', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const data = await service.createPairing(req.tenantId, req.userId, parse(pairingSchema, req.body || {}));
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});

router.delete('/dispositivos-mesero/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.revokeDevice(req.tenantId, req.userId, req.params.id) }); } catch (error) { next(error); }
});

module.exports = { restaurantWaiterDeviceRouter: router };
