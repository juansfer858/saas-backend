'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const demoBar = require('./restaurant-demo-bar-accounts-v1.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value || {});
  if (!result.success) throw new AppError(400, 'Datos del piloto VANTIX BAR inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  guestCount: z.coerce.number().int().min(1).max(50).optional()
});

const accountRenameSchema = z.object({
  name: z.string().trim().min(1).max(160)
});

router.get('/v2/demo-bar/workspace', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok:true, data:await demoBar.workspace(req.tenantId) }); }
  catch (error) { next(error); }
});

router.post('/v2/demo-bar/mesas/:tableId/cuentas', requirePermission('MESAS.CREAR'), async (req, res, next) => {
  try {
    const input = parse(accountCreateSchema, req.body);
    res.status(201).json({ ok:true, data:await demoBar.createAccount(req.tenantId, req.user, req.params.tableId, input) });
  } catch (error) { next(error); }
});

router.patch('/v2/demo-bar/cuentas/:sessionId', requirePermission('PEDIDOS.CREAR'), async (req, res, next) => {
  try {
    const input = parse(accountRenameSchema, req.body);
    res.json({ ok:true, data:await demoBar.renameAccount(req.tenantId, req.user, req.params.sessionId, input) });
  } catch (error) { next(error); }
});

router.post('/v2/demo-bar/cuentas/:sessionId/pedir-cuenta', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await demoBar.requestAccount(req.tenantId, req.user, req.params.sessionId) }); }
  catch (error) { next(error); }
});

router.delete('/v2/demo-bar/cuentas/:sessionId/vacia', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await demoBar.closeEmptyAccount(req.tenantId, req.user, req.params.sessionId) }); }
  catch (error) { next(error); }
});

module.exports = { restaurantDemoBarRouter:router, accountCreateSchema, accountRenameSchema };
