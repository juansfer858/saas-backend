const express = require('express');
const { z } = require('zod');
const service = require('./restaurant.service');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de Restaurante inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const tableSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  seats: z.coerce.number().int().min(1).max(30).optional(),
  posX: z.coerce.number().int().min(0).max(5000).optional(),
  posY: z.coerce.number().int().min(0).max(5000).optional(),
  width: z.coerce.number().int().min(70).max(800).optional(),
  height: z.coerce.number().int().min(60).max(800).optional(),
  assignedWaiterId: z.string().uuid().optional().nullable(),
  state: z.enum(['LIBRE', 'RESERVADA']).optional()
});
const tableUpdateSchema = tableSchema.omit({ code: true }).partial().refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio' });
const openTableSchema = z.object({ guestCount: z.coerce.number().int().min(1).max(100).default(1), customerPhoneE164: z.string().trim().max(30).optional().nullable() });

const menuSchema = z.object({
  productId: z.string().uuid(),
  category: z.enum(['ENTRADAS', 'FUERTES', 'BEBIDAS', 'POSTRES']),
  station: z.enum(['COCINA', 'BARRA', 'POSTRES']),
  requiresRecipe: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional().default(0)
});

const orderItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(999),
  notes: z.string().trim().max(300).optional().nullable()
});
const orderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(100),
  notes: z.string().trim().max(500).optional().nullable(),
  customerPhoneE164: z.string().trim().max(30).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
});

const equalSplit = z.object({ mode: z.literal('EQUAL'), parts: z.coerce.number().int().min(2).max(50) });
const itemSplit = z.object({
  mode: z.literal('BY_ITEM'),
  assignments: z.array(z.object({ name: z.string().trim().max(80).optional(), saleDetailIds: z.array(z.string().uuid()).min(1) })).min(2).max(50)
});
const noneSplit = z.object({ mode: z.literal('NONE') });
const closeSchema = z.object({
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']),
  cajaBancoId: z.string().uuid().optional().nullable(),
  tipAmount: z.coerce.number().min(0).max(100000000).default(0),
  split: z.union([equalSplit, itemSplit, noneSplit]).optional().nullable()
});

const cashOpenSchema = z.object({ cajaBancoId: z.string().uuid(), saldoInicial: z.coerce.number().min(0).max(1000000000).default(0) });
const cashCloseSchema = z.object({ saldoFinal: z.coerce.number().min(0).max(1000000000) });
const commandSchema = z.object({ state: z.enum(['PENDIENTE', 'EN_PREPARACION', 'LISTA', 'ENTREGADA', 'CANCELADA']) });
const operationalConfigSchema = z.object({ whatsappOrderReadyEnabled: z.boolean().optional(), allowSimulatedDocumentEquivalent: z.boolean().optional() }).refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio' });
const gatesSchema = z.object({
  physicalPrinterFieldPass: z.boolean().optional(),
  physicalPrinterEvidence: z.record(z.string(), z.any()).optional().nullable(),
  metaBusinessManagementReviewPass: z.boolean().optional(),
  metaReviewEvidence: z.record(z.string(), z.any()).optional().nullable(),
  dianRealEnabled: z.boolean().optional(),
  dianEvidence: z.record(z.string(), z.any()).optional().nullable(),
  simulatedFiscalOperationExplicitlyAccepted: z.boolean().optional(),
  simulatedFiscalDecisionEvidence: z.record(z.string(), z.any()).optional().nullable()
});

router.get('/status', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getStatus(req.tenantId) }); } catch (error) { next(error); }
});
router.patch('/config', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveOperationalConfig(req.tenantId, parse(operationalConfigSchema, req.body)) }); } catch (error) { next(error); }
});
router.patch('/gates', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.updateProductionGates(req.tenantId, req.userId, parse(gatesSchema, req.body)) }); } catch (error) { next(error); }
});

router.get('/mesas', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listTables(req.tenantId, req.user) }); } catch (error) { next(error); }
});
router.post('/mesas', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createTable(req.tenantId, parse(tableSchema, req.body)) }); } catch (error) { next(error); }
});
router.patch('/mesas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.updateTable(req.tenantId, req.params.id, parse(tableUpdateSchema, req.body)) }); } catch (error) { next(error); }
});
router.delete('/mesas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.removeTable(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/abrir', requirePermission('MESAS.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.openTable(req.tenantId, req.user, req.params.id, parse(openTableSchema, req.body || {})) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/pedir-cuenta', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.requestAccount(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/cerrar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.closeTable(req.tenantId, req.user, req.params.id, parse(closeSchema, req.body)) }); } catch (error) { next(error); }
});
router.get('/sesiones/:id', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getSession(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

router.get('/menu', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listMenu(req.tenantId, { category: req.query.category, station: req.query.station, active: req.query.active === undefined ? undefined : req.query.active === 'true' }) }); } catch (error) { next(error); }
});
router.post('/menu', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.saveMenuItem(req.tenantId, null, parse(menuSchema, req.body)) }); } catch (error) { next(error); }
});
router.put('/menu/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveMenuItem(req.tenantId, req.params.id, parse(menuSchema, req.body)) }); } catch (error) { next(error); }
});
router.delete('/menu/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.deactivateMenuItem(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

router.get('/pedidos', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listOrders(req.tenantId, { sessionId: req.query.sessionId, state: req.query.state, limit: req.query.limit }, req.user) }); } catch (error) { next(error); }
});
router.post('/sesiones/:sessionId/pedidos', requirePermission('PEDIDOS.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.placeWaiterOrder(req.tenantId, req.user, req.params.sessionId, parse(orderSchema, req.body)) }); } catch (error) { next(error); }
});

router.get('/comandas', requirePermission('COMANDAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listCommands(req.tenantId, req.user, { station: req.query.station, state: req.query.state, limit: req.query.limit }) }); } catch (error) { next(error); }
});
router.patch('/comandas/:id', requirePermission('COMANDAS.EDITAR'), async (req, res, next) => {
  try { const input = parse(commandSchema, req.body); res.json({ ok: true, data: await service.updateCommandState(req.tenantId, req.user, req.params.id, input.state) }); } catch (error) { next(error); }
});

router.post('/caja/abrir', requirePermission('TESORERIA.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.openCashShift(req.tenantId, req.userId, parse(cashOpenSchema, req.body)) }); } catch (error) { next(error); }
});
router.get('/caja/turnos/:id/resumen', requirePermission('TESORERIA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.cashShiftSummary(req.tenantId, req.userId, req.params.id) }); } catch (error) { next(error); }
});
router.post('/caja/turnos/:id/cerrar', requirePermission('TESORERIA.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.closeCashShift(req.tenantId, req.userId, req.params.id, parse(cashCloseSchema, req.body)) }); } catch (error) { next(error); }
});

module.exports = { restaurantRouter: router };
