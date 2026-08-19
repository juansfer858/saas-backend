const express = require('express');
const { z } = require('zod');
const service = require('./payroll.service');
const { AppError } = require('../../../utils/app-error');
const { requirePermission } = require('../../../middleware/require-permission');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de nómina inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const employeeSchema = z.object({
  terceroId: z.string().uuid(),
  employeeCode: z.string().trim().min(1).max(40),
  contractType: z.string().trim().min(2).max(80),
  baseSalary: z.coerce.number().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  paymentMethod: z.string().trim().max(60).optional().nullable(),
  bankAccountMasked: z.string().trim().max(80).optional().nullable(),
  active: z.boolean().default(true)
});

const configSchema = z.object({
  expenseAccountId: z.string().uuid().optional().nullable(),
  payableAccountId: z.string().uuid().optional().nullable(),
  contributionAccountId: z.string().uuid().optional().nullable(),
  transmissionReminderDays: z.coerce.number().int().min(1).max(31).default(5)
});

const lineSchema = z.object({
  employeeId: z.string().uuid(),
  devengados: z.record(z.string(), z.any()).default({}),
  deducciones: z.record(z.string(), z.any()).default({}),
  totalDevengado: z.coerce.number().positive(),
  totalDeducido: z.coerce.number().min(0)
});
const periodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2200),
  month: z.coerce.number().int().min(1).max(12),
  frequency: z.enum(['MENSUAL','QUINCENAL']).default('MENSUAL'),
  lines: z.array(lineSchema).min(1).max(1000)
});

router.get('/empleados', requirePermission('NOMINA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listEmployees(req.tenantId) }); }
  catch (error) { next(error); }
});
router.post('/empleados', requirePermission('NOMINA.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.saveEmployee(req.tenantId, parse(employeeSchema, req.body)) }); }
  catch (error) { next(error); }
});
router.get('/configuracion', requirePermission('NOMINA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getConfig(req.tenantId) }); }
  catch (error) { next(error); }
});
router.put('/configuracion', requirePermission('NOMINA.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveConfig(req.tenantId, req.userId, parse(configSchema, req.body)) }); }
  catch (error) { next(error); }
});
router.get('/periodos', requirePermission('NOMINA.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listPeriods(req.tenantId) }); }
  catch (error) { next(error); }
});
router.post('/periodos', requirePermission('NOMINA.CREAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createPeriod(req.tenantId, req.userId, parse(periodSchema, req.body)) }); }
  catch (error) { next(error); }
});
router.post('/periodos/:id/generar', requirePermission('NOMINA.EMITIR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.generatePeriod(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});
router.post('/periodos/:id/sincronizar-dian', requirePermission('NOMINA.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.syncTransmissionState(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

module.exports = { payrollRouter: router };
