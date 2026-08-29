'use strict';

const express = require('express');
const { z } = require('zod');
const identity = require('./restaurant-identity.service');
const restaurant = require('./restaurant.service');
const work = require('./restaurant-employee-work.service');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Asignación de empleado inválida', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const assignmentSchema = z.object({
  zoneIds:z.array(z.string().uuid()).max(50).optional().default([]),
  tableIds:z.array(z.string().uuid()).max(500).optional().default([]),
  stations:z.array(z.enum(['COCINA','BARRA','POSTRES'])).max(3).optional().default([])
});
const commandStateSchema = z.object({ state:z.enum(['PENDIENTE','EN_PREPARACION','LISTA','ENTREGADA','CANCELADA']) });

// Esta ruta se monta antes del router Restaurante histórico. Mantiene el rol real
// para RBAC, pero entrega el alcance flexible que la interfaz usa para priorizar trabajo.
router.get('/ui-context', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try {
    const [context, assignment] = await Promise.all([
      identity.uiContext(req.tenantId, req.user),
      work.getProfile(req.tenantId, req.user.id)
    ]);
    const baseRole = String(req.user?.rol || '').toUpperCase();
    context.user = { ...context.user, baseRol:baseRole, rol:work.uiRoleFor(req.user) };
    context.workAssignment = assignment;
    res.json({ ok:true, data:context });
  } catch (error) { next(error); }
});

// Producción puede reforzar otro módulo. El permiso sigue siendo COMANDAS.* del
// rol real; sólo se elimina el bloqueo rígido COCINA/BARRA/POSTRES del dominio.
router.get('/comandas', requirePermission('COMANDAS.VER'), async (req, res, next) => {
  try {
    const runtimeUser = work.productionRuntimeUser(req.user);
    const data = await restaurant.listCommands(req.tenantId, runtimeUser, {
      station:req.query.station,
      state:req.query.state,
      limit:req.query.limit
    });
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});
router.patch('/comandas/:id', requirePermission('COMANDAS.EDITAR'), async (req, res, next) => {
  try {
    const input = parse(commandStateSchema, req.body || {});
    const data = await restaurant.updateCommandState(req.tenantId, work.productionRuntimeUser(req.user), req.params.id, input.state);
    res.json({ ok:true, data });
  } catch (error) { next(error); }
});

router.get('/empleados/asignaciones/opciones', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await work.options(req.tenantId) }); } catch (error) { next(error); }
});
router.get('/empleados/asignaciones', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await work.listProfiles(req.tenantId) }); } catch (error) { next(error); }
});
router.get('/empleados/:userId/asignacion', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await work.getProfile(req.tenantId, req.params.userId) }); } catch (error) { next(error); }
});
router.put('/empleados/:userId/asignacion', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(assignmentSchema, req.body || {});
    res.json({ ok:true, data:await work.saveProfile(req.tenantId, req.userId, req.params.userId, input) });
  } catch (error) { next(error); }
});

module.exports = { restaurantEmployeeWorkRouter:router };
