const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { edgeAuth } = require('./edge.auth');
const service = require('./edge.service');

const tenantRouter = express.Router();
const publicRouter = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos Edge inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const agentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  pointCode: z.string().trim().min(2).max(50),
  defaultCustomerId: z.string().uuid().optional().nullable(),
  defaultCashAccountId: z.string().uuid().optional().nullable(),
  softwareVersion: z.string().trim().max(50).optional().nullable()
});

const offlinePolicySchema = z.object({
  paymentPolicy: z.enum(['CASH_ONLY', 'MANUAL_EXTERNAL_PENDING', 'PAUSE_SALES']),
  manualPaymentNote: z.string().trim().max(500).optional().nullable()
});

const operationsSchema = z.object({
  operations: z.array(z.object({
    id: z.string().trim().min(8).max(120),
    type: z.string().trim().min(2).max(80),
    localTimestamp: z.coerce.date(),
    payload: z.record(z.string(), z.any())
  })).min(1).max(200)
});

tenantRouter.get('/policy', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getOfflinePolicy(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.put('/policy', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveOfflinePolicy(req.tenantId, req.userId, parse(offlinePolicySchema, req.body)) }); }
  catch (error) { next(error); }
});

tenantRouter.get('/agents', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAgents(req.tenantId) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/agents', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.provisionAgent(req.tenantId, req.userId, parse(agentSchema, req.body)) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/agents/:id/revoke', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.revokeAgent(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/agents/:id/rotate-key', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.rotateCredential(req.tenantId, req.params.id) }); }
  catch (error) { next(error); }
});

tenantRouter.get('/alerts', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAlerts(req.tenantId, req.query) }); }
  catch (error) { next(error); }
});

tenantRouter.post('/alerts/:id/ack', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.acknowledgeAlert(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});

publicRouter.use(edgeAuth);

publicRouter.get('/ping', (req, res) => {
  res.json({ ok: true, connected: true, serverTime: new Date().toISOString(), edgeAgentId: req.edgeAgent.id, tenantId: req.edgeAgent.tenantId });
});

publicRouter.get('/bootstrap', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.buildBootstrap(req.edgeAgent) }); }
  catch (error) { next(error); }
});

publicRouter.post('/sync/operations', async (req, res, next) => {
  try {
    const input = parse(operationsSchema, req.body);
    res.json({ ok: true, data: await service.processOperations(req.edgeAgent, input.operations) });
  } catch (error) { next(error); }
});

module.exports = { edgeTenantRouter: tenantRouter, edgePublicRouter: publicRouter };
