'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./push-v65.service');

const router = express.Router();
const registerSchema = z.object({
  token:z.string().trim().min(20).max(8192),
  platform:z.string().trim().min(2).max(30).default('WEB'),
  deviceLabel:z.string().trim().max(120).optional().nullable(),
  permission:z.enum(['granted','default','denied']).default('granted'),
  userAgent:z.string().trim().max(1000).optional().nullable()
});
const testSchema = z.object({ deviceId:z.string().uuid().optional().nullable() });

function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'Datos push inválidos', 'PUSH_VALIDATION_ERROR', parsed.error.flatten());
  return parsed.data;
}

router.get('/estado', requirePermission('RESTAURANTE.VER'), async (req,res,next) => {
  try {
    res.json({ ok:true, data:{ config:service.publicConfig(), devices:await service.listMyDevices(req.tenantId, req.userId) } });
  } catch (error) { next(error); }
});

router.post('/dispositivos', requirePermission('RESTAURANTE.VER'), async (req,res,next) => {
  try {
    const input = parse(registerSchema, req.body);
    const device = await service.registerDevice({
      tenantId:req.tenantId,
      userId:req.userId,
      role:req.userRole,
      authType:req.authType,
      deviceId:req.deviceId
    }, input);
    res.status(201).json({ ok:true, data:device });
  } catch (error) { next(error); }
});

router.delete('/dispositivos/:id', requirePermission('RESTAURANTE.VER'), async (req,res,next) => {
  try { res.json({ ok:true, data:await service.revokeDevice(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/prueba', requirePermission('RESTAURANTE.VER'), async (req,res,next) => {
  try { res.json({ ok:true, data:await service.sendSelfTest(req.tenantId, req.userId, parse(testSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

module.exports = { notificationPushV65Router:router };
