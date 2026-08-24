const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { edgeAuth } = require('./edge.auth');
const { edgeRemotePublicRouter } = require('./edge-remote.public.routes');
const service = require('./edge.service');
const platform = require('./edge-platform.service');
const restaurantSync = require('./edge-restaurant-sync.service');
const remoteAgent = require('./edge-remote-agent.service');
const workspace = require('./edge-workspace.service');

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
const operationSchema = z.object({
  id: z.string().trim().min(8).max(120),
  type: z.string().trim().min(2).max(80),
  localTimestamp: z.coerce.date(),
  payload: z.record(z.string(), z.any())
});
const operationsSchema = z.object({ operations: z.array(operationSchema).min(1).max(200) });
const heartbeatSchema = z.object({
  installationId: z.string().trim().min(8).max(160),
  deviceName: z.string().trim().max(160).optional().nullable(),
  os: z.string().trim().max(80).optional().nullable(),
  architecture: z.string().trim().max(50).optional().nullable(),
  lanHost: z.string().trim().max(120).optional().nullable(),
  lanPort: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  softwareVersion: z.string().trim().max(80).optional().nullable(),
  healthStatus: z.string().trim().max(40).optional(),
  health: z.record(z.string(), z.any()).optional().nullable(),
  relayConnected: z.boolean().optional(),
  updaterState: z.string().trim().max(60).optional()
});
const releaseSchema = z.object({
  version: z.string().trim().min(1).max(80),
  channel: z.enum(['PILOT', 'STABLE']).optional(),
  artifactUrl: z.string().url().max(2000),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  releaseNotes: z.string().max(5000).optional().nullable(),
  minCoreVersion: z.string().trim().max(80).optional().nullable(),
  mandatory: z.boolean().optional(),
  enabled: z.boolean().optional()
});
const deploymentReportSchema = z.object({
  deploymentId: z.string().uuid(),
  state: z.enum(['DOWNLOADING', 'BACKUP', 'INSTALLING', 'HEALTHCHECK', 'SUCCESS', 'ROLLED_BACK', 'FAILED']),
  backupPath: z.string().max(1000).optional().nullable(),
  errorCode: z.string().max(120).optional().nullable(),
  errorMessage: z.string().max(2000).optional().nullable(),
  evidence: z.record(z.string(), z.any()).optional().nullable()
});
const relaySchema = z.object({
  edgeAgentId: z.string().uuid(),
  action: z.enum(['STATUS', 'SYNC_NOW', 'CATALOG', 'PRINT_QUEUE', 'REMOTE_ORDERS', 'UPDATE_CHECK']),
  requestBody: z.record(z.string(), z.any()).optional().nullable(),
  ttlSeconds: z.coerce.number().int().min(15).max(300).optional()
});
const relayCompleteSchema = z.object({
  ok: z.boolean().optional(),
  response: z.record(z.string(), z.any()).optional().nullable(),
  errorCode: z.string().max(120).optional().nullable(),
  errorMessage: z.string().max(2000).optional().nullable()
});
const remoteChannelSchema = z.object({
  edgeAgentId: z.string().uuid(),
  type: z.enum(['MESA', 'DOMICILIO', 'RECOGER']),
  name: z.string().trim().min(1).max(120),
  tableId: z.string().uuid().optional().nullable()
});
const remoteReportSchema = z.object({
  state: z.enum(['APPROVED', 'PREPARING', 'READY', 'IN_TRANSIT', 'DELIVERED', 'PICKED_UP', 'REJECTED', 'CANCELED']).optional(),
  localOperationId: z.string().trim().max(120).optional().nullable(),
  originDocumentId: z.string().trim().max(120).optional().nullable()
});
const localGrantConsumeSchema = z.object({ token: z.string().trim().min(20).max(300) });

tenantRouter.get('/policy', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getOfflinePolicy(req.tenantId) }); } catch (error) { next(error); }
});
tenantRouter.put('/policy', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveOfflinePolicy(req.tenantId, req.userId, parse(offlinePolicySchema, req.body)) }); } catch (error) { next(error); }
});
tenantRouter.get('/agents', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAgents(req.tenantId) }); } catch (error) { next(error); }
});
tenantRouter.post('/agents', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.provisionAgent(req.tenantId, req.userId, parse(agentSchema, req.body)) }); } catch (error) { next(error); }
});
tenantRouter.post('/agents/:id/revoke', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.revokeAgent(req.tenantId, req.userId, req.params.id) }); } catch (error) { next(error); }
});
tenantRouter.post('/agents/:id/rotate-key', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.rotateCredential(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});
tenantRouter.post('/agents/:id/local-access-grant', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await workspace.createLocalAccessGrant(req.tenantId, req.user, req.params.id) }); } catch (error) { next(error); }
});
tenantRouter.patch('/agents/:id/release-channel', async (req, res, next) => {
  try {
    const input = parse(z.object({ channel: z.enum(['PILOT', 'STABLE']) }), req.body);
    res.json({ ok: true, data: await platform.setReleaseChannel(req.tenantId, req.params.id, input.channel) });
  } catch (error) { next(error); }
});
tenantRouter.get('/installations', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.listInstallations(req.tenantId) }); } catch (error) { next(error); }
});
tenantRouter.get('/releases', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.listReleases(req.tenantId) }); } catch (error) { next(error); }
});
tenantRouter.post('/releases', async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await platform.createRelease(req.tenantId, req.userId, parse(releaseSchema, req.body)) }); } catch (error) { next(error); }
});
tenantRouter.post('/agents/:id/deploy', async (req, res, next) => {
  try {
    const input = parse(z.object({ releaseId: z.string().uuid() }), req.body);
    res.status(201).json({ ok: true, data: await platform.requestDeployment(req.tenantId, req.userId, req.params.id, input.releaseId) });
  } catch (error) { next(error); }
});
tenantRouter.post('/relay/requests', async (req, res, next) => {
  try {
    const input = parse(relaySchema, req.body);
    res.status(201).json({ ok: true, data: await platform.createRelayRequest(req.tenantId, input.edgeAgentId, input.action, input.requestBody, input.ttlSeconds) });
  } catch (error) { next(error); }
});
tenantRouter.get('/relay/requests/:id', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.getRelayRequest(req.tenantId, req.params.id) }); } catch (error) { next(error); }
});
tenantRouter.get('/remote-channels', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.listRemoteChannels(req.tenantId) }); } catch (error) { next(error); }
});
tenantRouter.post('/remote-channels', async (req, res, next) => {
  try {
    const input = parse(remoteChannelSchema, req.body);
    const data = await platform.createRemoteChannel(req.tenantId, input.edgeAgentId, input);
    data.publicPath = `/edge/api/v1/remote/${data.token}`;
    res.status(201).json({ ok: true, data });
  } catch (error) { next(error); }
});
tenantRouter.post('/remote-channels/:id/rotate-token', async (req, res, next) => {
  try {
    const data = await platform.rotateRemoteChannel(req.tenantId, req.params.id);
    data.publicPath = `/edge/api/v1/remote/${data.token}`;
    res.json({ ok: true, data });
  } catch (error) { next(error); }
});
tenantRouter.get('/remote-orders', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.listRemoteOrders(req.tenantId, req.query) }); } catch (error) { next(error); }
});
tenantRouter.post('/remote-orders/:id/approve', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.decideRemoteOrder(req.tenantId, req.params.id, 'APPROVE') }); } catch (error) { next(error); }
});
tenantRouter.post('/remote-orders/:id/reject', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.decideRemoteOrder(req.tenantId, req.params.id, 'REJECT') }); } catch (error) { next(error); }
});
tenantRouter.get('/alerts', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAlerts(req.tenantId, req.query) }); } catch (error) { next(error); }
});
tenantRouter.post('/alerts/:id/ack', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.acknowledgeAlert(req.tenantId, req.userId, req.params.id) }); } catch (error) { next(error); }
});

// Customer token routes must be mounted before Edge device authentication.
publicRouter.use('/remote', edgeRemotePublicRouter);
publicRouter.use(edgeAuth);
publicRouter.get('/ping', (req, res) => res.json({ ok: true, connected: true, serverTime: new Date().toISOString(), edgeAgentId: req.edgeAgent.id, tenantId: req.edgeAgent.tenantId }));
publicRouter.post('/local-access/consume', async (req, res, next) => {
  try {
    const input = parse(localGrantConsumeSchema, req.body || {});
    res.json({ ok: true, data: await workspace.consumeLocalAccessGrant(req.edgeAgent, input.token) });
  } catch (error) { next(error); }
});
publicRouter.get('/bootstrap', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.buildBootstrap(req.edgeAgent) }); } catch (error) { next(error); }
});
publicRouter.get('/restaurant/bootstrap', async (req, res, next) => {
  try { res.json({ ok: true, data: await restaurantSync.buildRestaurantBootstrap(req.edgeAgent) }); } catch (error) { next(error); }
});
publicRouter.post('/sync/operations', async (req, res, next) => {
  try { res.json({ ok: true, data: await service.processOperations(req.edgeAgent, parse(operationsSchema, req.body).operations) }); } catch (error) { next(error); }
});
publicRouter.post('/sync/restaurant-operations', async (req, res, next) => {
  try { res.json({ ok: true, data: await restaurantSync.processOperations(req.edgeAgent, parse(operationsSchema, req.body).operations) }); } catch (error) { next(error); }
});
publicRouter.post('/heartbeat', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.heartbeat(req.edgeAgent, parse(heartbeatSchema, req.body)) }); } catch (error) { next(error); }
});
publicRouter.get('/update/manifest', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.updateManifest(req.edgeAgent) }); } catch (error) { next(error); }
});
publicRouter.post('/update/report', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.reportDeployment(req.edgeAgent, parse(deploymentReportSchema, req.body)) }); } catch (error) { next(error); }
});
publicRouter.get('/relay/pull', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.pullRelayRequests(req.edgeAgent, req.query.limit) }); } catch (error) { next(error); }
});
publicRouter.post('/relay/:id/complete', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.completeRelayRequest(req.edgeAgent, req.params.id, parse(relayCompleteSchema, req.body || {})) }); } catch (error) { next(error); }
});
publicRouter.get('/remote-orders/pull', async (req, res, next) => {
  try { res.json({ ok: true, data: await remoteAgent.pull(req.edgeAgent, req.query.limit) }); } catch (error) { next(error); }
});
publicRouter.post('/remote-orders/:id/report', async (req, res, next) => {
  try { res.json({ ok: true, data: await platform.reportRemoteOrder(req.edgeAgent, req.params.id, parse(remoteReportSchema, req.body || {})) }); } catch (error) { next(error); }
});

module.exports = { edgeTenantRouter: tenantRouter, edgePublicRouter: publicRouter };
