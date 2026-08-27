const express = require('express');
const { z } = require('zod');
const { prisma } = require('../../config/prisma');
const service = require('./restaurant.service');
const identity = require('./restaurant-identity.service');
const liveTables = require('./restaurant-live-tables.service');
const zones = require('./restaurant-zones.service');
const theme = require('./restaurant-theme.service');
const qr = require('./restaurant-qr.service');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de Restaurante inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const zoneSchema = z.object({ name: z.string().trim().min(1).max(80) });

const tableSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  zoneId: z.string().uuid().optional(),
  seats: z.coerce.number().int().min(1).max(30).optional(),
  posX: z.coerce.number().int().min(0).max(5000).optional(),
  posY: z.coerce.number().int().min(0).max(5000).optional(),
  width: z.coerce.number().int().min(70).max(800).optional(),
  height: z.coerce.number().int().min(60).max(800).optional(),
  assignedWaiterId: z.string().uuid().optional().nullable(),
  state: z.enum(['LIBRE', 'RESERVADA']).optional()
});
const tableUpdateSchema = tableSchema.omit({ code: true }).partial().refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio' });
const openTableSchema = z.object({
  guestCount: z.coerce.number().int().min(1).max(100).default(1),
  billingMode: z.enum(['CONJUNTA', 'INDIVIDUAL']).optional().default('CONJUNTA'),
  customerPhoneE164: z.string().trim().max(30).optional().nullable()
});
const serviceSetupSchema = z.object({
  billingMode: z.enum(['CONJUNTA', 'INDIVIDUAL']).optional(),
  guestCount: z.coerce.number().int().min(1).max(50).optional()
}).refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio de servicio' });

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
  seatNumber: z.coerce.number().int().min(1).max(50).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable()
});
const orderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(100),
  notes: z.string().trim().max(500).optional().nullable(),
  customerPhoneE164: z.string().trim().max(30).optional().nullable(),
  externalRequestId: z.string().trim().min(3).max(120).optional().nullable()
});
const draftQtySchema = z.object({
  quantity: z.coerce.number().min(0).max(999),
  seatNumber: z.coerce.number().int().min(1).max(50).optional().nullable()
});
const orderItemMetaSchema = z.object({
  seatNumber: z.coerce.number().int().min(1).max(50).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable()
}).refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio del ítem' });

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
  dianEvidence: z.record(z.string(), z.any()).optional().nullable()
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal inválido');
const fontFamily = z.string().trim().min(1).max(180).regex(/^[^;{}<>]+$/, 'Tipografía inválida');
const themeSchema = z.object({
  preset: z.string().trim().min(1).max(40).optional(),
  restaurantName: z.string().trim().min(1).max(100).optional().nullable(),
  tokens: z.object({
    char: hexColor.optional(), bone: hexColor.optional(), ember: hexColor.optional(), verdigris: hexColor.optional(), brass: hexColor.optional(),
    paper: hexColor.optional(), ink: hexColor.optional(), muted: hexColor.optional(), line: hexColor.optional(), success: hexColor.optional(), danger: hexColor.optional()
  }).optional(),
  typography: z.object({ display: fontFamily.optional(), body: fontFamily.optional(), mono: fontFamily.optional() }).optional()
}).refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio de tema' });

router.get('/ui-context', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.uiContext(req.tenantId, req.user) }); } catch (error) { next(error); }
});
router.get('/theme', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await theme.getTheme(req.tenantId) }); } catch (error) { next(error); }
});
router.patch('/theme', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await theme.saveTheme(req.tenantId, req.userId, parse(themeSchema, req.body)) }); } catch (error) { next(error); }
});

router.get('/status', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getStatus(req.tenantId) }); } catch (error) { next(error); }
});
router.patch('/config', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveOperationalConfig(req.tenantId, parse(operationalConfigSchema, req.body)) }); } catch (error) { next(error); }
});
router.patch('/gates', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'simulatedFiscalOperationExplicitlyAccepted') || Object.prototype.hasOwnProperty.call(req.body || {}, 'simulatedFiscalDecisionEvidence')) {
      throw new AppError(403, 'La aceptación de operación fiscal simulada solo puede ser administrada por un super-administrador desde el Panel SaaS', 'RESTAURANT_SIMULATED_FISCAL_PLATFORM_ONLY');
    }
    res.json({ ok: true, data: await service.updateProductionGates(req.tenantId, req.userId, parse(gatesSchema, req.body)) });
  } catch (error) { next(error); }
});

router.get('/zonas', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await zones.listZones(req.tenantId, req.user) }); } catch (error) { next(error); }
});
router.post('/zonas', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await zones.createZone(req.tenantId, parse(zoneSchema, req.body)) }); } catch (error) { next(error); }
});
router.patch('/zonas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await zones.renameZone(req.tenantId, req.params.id, parse(zoneSchema, req.body)) }); } catch (error) { next(error); }
});
router.delete('/zonas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await zones.removeZone(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

router.get('/qrs', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.visibleMaterials(req.tenantId, req.user) }); } catch (error) { next(error); }
});
router.get('/zonas/:id/qrs', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.visibleMaterials(req.tenantId, req.user, { zoneId:req.params.id }) }); } catch (error) { next(error); }
});
router.get('/mesas/:id/qr', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.tableMaterial(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/qr/regenerar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await qr.regenerateTableQr(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

router.get('/mesas', requirePermission('MESAS.VER'), async (req, res, next) => {
  try {
    await zones.ensureDefaultZone(req.tenantId);
    res.json({ ok: true, data: await liveTables.listTablesLive(req.tenantId, req.user) });
  } catch (error) { next(error); }
});
router.post('/mesas', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(tableSchema, req.body);
    const zone = await zones.resolveZoneForTable(req.tenantId, input.zoneId);
    const table = await service.createTable(req.tenantId, input);
    try {
      const assigned = await zones.assignTable(req.tenantId, table.id, zone.id);
      res.status(201).json({ ok: true, data: assigned });
    } catch (error) {
      await service.removeTable(req.tenantId, table.id).catch(() => {});
      throw error;
    }
  } catch (error) { next(error); }
});
router.patch('/mesas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const input = parse(tableUpdateSchema, req.body);
    const hasZone = Object.prototype.hasOwnProperty.call(input, 'zoneId');
    const { zoneId, ...tableChanges } = input;
    let row = null;
    if (Object.keys(tableChanges).length) row = await service.updateTable(req.tenantId, req.params.id, tableChanges);
    else row = await prisma.restaurantTable.findFirst({ where: { id: req.params.id, tenantId: req.tenantId, active: true } });
    if (!row) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    if (hasZone) row = await zones.assignTable(req.tenantId, req.params.id, zoneId);
    res.json({ ok: true, data: row });
  } catch (error) { next(error); }
});
router.delete('/mesas/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.removeTable(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/abrir', requirePermission('MESAS.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.openTable(req.tenantId, req.user, req.params.id, parse(openTableSchema, req.body || {})) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/preparar-cuenta', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.prepareAccount(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/enviar-caja', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.sendAccountToCash(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/pedir-cuenta', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.requestAccount(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
router.post('/mesas/:id/cerrar', requirePermission('RESTAURANTE.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.closeTableGuarded(req.tenantId, req.user, req.params.id, parse(closeSchema, req.body)) }); } catch (error) { next(error); }
});
router.get('/sesiones/:id', requirePermission('MESAS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getSession(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});
router.patch('/sesiones/:sessionId/servicio', requirePermission('MESAS.EDITAR'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await identity.updateTableServiceSetup(req.tenantId, req.user, req.params.sessionId, parse(serviceSetupSchema, req.body)) });
  } catch (error) { next(error); }
});
router.patch('/sesiones/:sessionId/items/:itemId', requirePermission('PEDIDOS.CREAR'), async (req, res, next) => {
  try {
    res.json({ ok: true, data: await identity.updateOrderItemMeta(req.tenantId, req.user, req.params.sessionId, req.params.itemId, parse(orderItemMetaSchema, req.body)) });
  } catch (error) { next(error); }
});

router.get('/menu', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listMenu(req.tenantId, { category: req.query.category, station: req.query.station, active: req.query.active === undefined ? undefined : req.query.active === 'true' }) }); } catch (error) { next(error); }
});
router.post('/menu', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.saveMenuItem(req.tenantId, null, parse(menuSchema, req.body)) }); } catch (error) { next(error); }
});
router.put('/menu/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try {
    const owned = await prisma.restaurantMenuItem.findFirst({ where: { id: req.params.id, tenantId: req.tenantId }, select: { id: true } });
    if (!owned) throw new AppError(404, 'Ítem de menú no encontrado', 'RESTAURANT_MENU_ITEM_NOT_FOUND');
    res.json({ ok: true, data: await service.saveMenuItem(req.tenantId, req.params.id, parse(menuSchema, req.body)) });
  } catch (error) { next(error); }
});
router.delete('/menu/:id', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.deactivateMenuItem(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});

router.get('/sesiones/:sessionId/pedido-borrador', requirePermission('PEDIDOS.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.getWaiterDraft(req.tenantId, req.user, req.params.sessionId) }); } catch (error) { next(error); }
});
router.put('/sesiones/:sessionId/pedido-borrador/items/:menuItemId', requirePermission('PEDIDOS.CREAR'), async (req, res, next) => {
  try {
    const input = parse(draftQtySchema, req.body);
    res.json({ ok: true, data: await identity.setWaiterDraftItem(req.tenantId, req.user, req.params.sessionId, req.params.menuItemId, input.quantity, input.seatNumber) });
  } catch (error) { next(error); }
});
router.post('/sesiones/:sessionId/pedido-borrador/enviar', requirePermission('PEDIDOS.CREAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await identity.sendWaiterDraft(req.tenantId, req.user, req.params.sessionId) }); } catch (error) { next(error); }
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
  try { res.json({ ok: true, data: await identity.cashShiftSummary(req.tenantId, req.userId, req.params.id) }); } catch (error) { next(error); }
});
router.post('/caja/turnos/:id/cerrar', requirePermission('TESORERIA.CERRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.closeCashShift(req.tenantId, req.userId, req.params.id, parse(cashCloseSchema, req.body)) }); } catch (error) { next(error); }
});

module.exports = { restaurantRouter: router };
