const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const restaurant = require('../restaurant/restaurant.service');

const ACTIVE_DEPLOYMENT_STATES = ['PENDING', 'DOWNLOADING', 'BACKUP', 'INSTALLING', 'HEALTHCHECK'];
const ALLOWED_RELAY_ACTIONS = new Set(['STATUS', 'SYNC_NOW', 'CATALOG', 'PRINT_QUEUE', 'REMOTE_ORDERS', 'UPDATE_CHECK']);
const REMOTE_ORDER_TRANSITIONS = Object.freeze({
  PENDING_CONFIRMATION: new Set(['APPROVED', 'REJECTED', 'CANCELED']),
  APPROVED: new Set(['PREPARING', 'REJECTED', 'CANCELED']),
  PREPARING: new Set(['READY', 'CANCELED']),
  READY: new Set(['IN_TRANSIT', 'DELIVERED', 'PICKED_UP']),
  IN_TRANSIT: new Set(['DELIVERED']),
  NEW: new Set(['APPROVED', 'REJECTED', 'CANCELED'])
});

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function requireAgent(tenantId, edgeAgentId, activeOnly = true) {
  const where = { id: edgeAgentId, tenantId };
  if (activeOnly) where.state = 'ACTIVE';
  const agent = await prisma.edgeAgent.findFirst({ where });
  if (!agent) throw new AppError(404, 'Edge Agent no encontrado para este tenant', 'EDGE_AGENT_NOT_FOUND');
  return agent;
}

function heartbeatOnline(lastHeartbeatAt, now = Date.now()) {
  return Boolean(lastHeartbeatAt && now - new Date(lastHeartbeatAt).getTime() <= 90000);
}

async function heartbeat(agent, input = {}) {
  const installationId = String(input.installationId || '').trim();
  if (!installationId) throw new AppError(400, 'installationId es obligatorio', 'EDGE_INSTALLATION_ID_REQUIRED');
  const now = new Date();
  const data = {
    tenantId: agent.tenantId,
    installationId,
    deviceName: input.deviceName ? String(input.deviceName).slice(0, 160) : null,
    os: input.os ? String(input.os).slice(0, 80) : null,
    architecture: input.architecture ? String(input.architecture).slice(0, 50) : null,
    lanHost: input.lanHost ? String(input.lanHost).slice(0, 120) : null,
    lanPort: input.lanPort ? Number(input.lanPort) : null,
    softwareVersion: input.softwareVersion ? String(input.softwareVersion).slice(0, 80) : null,
    healthStatus: input.healthStatus ? String(input.healthStatus).slice(0, 40) : 'OK',
    lastHealth: input.health && typeof input.health === 'object' ? input.health : null,
    relayConnected: Boolean(input.relayConnected),
    lastRelayAt: input.relayConnected ? now : undefined,
    updaterState: input.updaterState ? String(input.updaterState).slice(0, 60) : 'IDLE',
    lastHeartbeatAt: now
  };
  let installation;
  try {
    installation = await prisma.edgeInstallation.upsert({
      where: { edgeAgentId: agent.id },
      create: { edgeAgentId: agent.id, ...data },
      update: data
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'installationId ya está vinculado a otro Edge Agent', 'EDGE_INSTALLATION_ID_CONFLICT');
    throw error;
  }
  await prisma.edgeAgent.update({
    where: { id: agent.id },
    data: { lastSeenAt: now, softwareVersion: data.softwareVersion || agent.softwareVersion }
  });
  return { ...installation, online: true };
}

async function listInstallations(tenantId) {
  const [agents, installations, deployments] = await Promise.all([
    prisma.edgeAgent.findMany({ where: { tenantId }, orderBy: [{ state: 'asc' }, { pointCode: 'asc' }] }),
    prisma.edgeInstallation.findMany({ where: { tenantId } }),
    prisma.edgeDeployment.findMany({ where: { tenantId, state: { in: ACTIVE_DEPLOYMENT_STATES } }, orderBy: { requestedAt: 'desc' } })
  ]);
  const byAgent = new Map(installations.map((x) => [x.edgeAgentId, x]));
  const deploymentByAgent = new Map();
  for (const deployment of deployments) if (!deploymentByAgent.has(deployment.edgeAgentId)) deploymentByAgent.set(deployment.edgeAgentId, deployment);
  const now = Date.now();
  return agents.map((agent) => {
    const installation = byAgent.get(agent.id) || null;
    return {
      agent,
      installation: installation ? { ...installation, online: heartbeatOnline(installation.lastHeartbeatAt, now) } : null,
      deployment: deploymentByAgent.get(agent.id) || null
    };
  });
}

async function setReleaseChannel(tenantId, edgeAgentId, channel) {
  await requireAgent(tenantId, edgeAgentId);
  if (!['PILOT', 'STABLE'].includes(channel)) throw new AppError(400, 'Canal de release inválido', 'EDGE_RELEASE_CHANNEL_INVALID');
  const current = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId } });
  if (!current) throw new AppError(409, 'El Edge debe enviar al menos un heartbeat antes de cambiar el canal', 'EDGE_INSTALLATION_NOT_REGISTERED');
  return prisma.edgeInstallation.update({ where: { edgeAgentId }, data: { releaseChannel: channel } });
}

async function createRelease(tenantId, userId, input) {
  const version = String(input.version || '').trim();
  const artifactUrl = String(input.artifactUrl || '').trim();
  const sha = String(input.sha256 || '').trim().toLowerCase();
  const channel = String(input.channel || 'PILOT').toUpperCase();
  if (!version || !artifactUrl || !/^[a-f0-9]{64}$/.test(sha)) throw new AppError(400, 'Release Edge inválido: versión, artifactUrl y SHA-256 son obligatorios', 'EDGE_RELEASE_INVALID');
  if (!['PILOT', 'STABLE'].includes(channel)) throw new AppError(400, 'Canal de release inválido', 'EDGE_RELEASE_CHANNEL_INVALID');
  try {
    return await prisma.edgeRelease.create({
      data: {
        tenantId,
        version,
        channel,
        artifactUrl,
        sha256: sha,
        releaseNotes: input.releaseNotes ? String(input.releaseNotes).slice(0, 5000) : null,
        minCoreVersion: input.minCoreVersion ? String(input.minCoreVersion).slice(0, 80) : null,
        mandatory: Boolean(input.mandatory),
        enabled: input.enabled !== false,
        createdByUserId: userId || null
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'Ya existe esa versión Edge para el tenant', 'EDGE_RELEASE_DUPLICATE');
    throw error;
  }
}

async function listReleases(tenantId) {
  return prisma.edgeRelease.findMany({
    where: { enabled: true, OR: [{ tenantId }, { tenantId: null }] },
    orderBy: { creadoEn: 'desc' },
    take: 100
  });
}

async function requestDeployment(tenantId, userId, edgeAgentId, releaseId) {
  const agent = await requireAgent(tenantId, edgeAgentId);
  const release = await prisma.edgeRelease.findFirst({ where: { id: releaseId, enabled: true, OR: [{ tenantId }, { tenantId: null }] } });
  if (!release) throw new AppError(404, 'Release Edge no encontrado', 'EDGE_RELEASE_NOT_FOUND');
  const active = await prisma.edgeDeployment.findFirst({ where: { tenantId, edgeAgentId, state: { in: ACTIVE_DEPLOYMENT_STATES } } });
  if (active) throw new AppError(409, 'El Edge ya tiene un despliegue en curso', 'EDGE_DEPLOYMENT_ACTIVE');
  const installation = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId } });
  const deployment = await prisma.edgeDeployment.create({
    data: {
      tenantId,
      edgeAgentId,
      installationId: installation?.installationId || null,
      releaseId: release.id,
      targetVersion: release.version,
      requestedByUserId: userId || null,
      previousVersion: installation?.softwareVersion || agent.softwareVersion || null
    }
  });
  if (installation) await prisma.edgeInstallation.update({ where: { edgeAgentId }, data: { desiredVersion: release.version, updaterState: 'PENDING' } });
  return { deployment, release };
}

async function updateManifest(agent) {
  const installation = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId: agent.id } });
  const deployment = await prisma.edgeDeployment.findFirst({
    where: { tenantId: agent.tenantId, edgeAgentId: agent.id, state: { in: ACTIVE_DEPLOYMENT_STATES } },
    orderBy: { requestedAt: 'asc' }
  });
  if (!deployment) return { updateAvailable: false, installation };
  const release = await prisma.edgeRelease.findUnique({ where: { id: deployment.releaseId } });
  if (!release?.enabled) return { updateAvailable: false, installation };
  return {
    updateAvailable: true,
    installation,
    deployment: {
      id: deployment.id,
      state: deployment.state,
      targetVersion: deployment.targetVersion,
      previousVersion: deployment.previousVersion
    },
    release: {
      version: release.version,
      channel: release.channel,
      artifactUrl: release.artifactUrl,
      sha256: release.sha256,
      mandatory: release.mandatory,
      releaseNotes: release.releaseNotes,
      minCoreVersion: release.minCoreVersion
    }
  };
}

async function reportDeployment(agent, input) {
  const deploymentId = String(input.deploymentId || '').trim();
  const state = String(input.state || '').trim().toUpperCase();
  const allowed = ['DOWNLOADING', 'BACKUP', 'INSTALLING', 'HEALTHCHECK', 'SUCCESS', 'ROLLED_BACK', 'FAILED'];
  if (!deploymentId || !allowed.includes(state)) throw new AppError(400, 'Reporte de actualización Edge inválido', 'EDGE_DEPLOYMENT_REPORT_INVALID');
  const deployment = await prisma.edgeDeployment.findFirst({ where: { id: deploymentId, tenantId: agent.tenantId, edgeAgentId: agent.id } });
  if (!deployment) throw new AppError(404, 'Despliegue Edge no encontrado', 'EDGE_DEPLOYMENT_NOT_FOUND');
  const now = new Date();
  const terminal = ['SUCCESS', 'ROLLED_BACK', 'FAILED'].includes(state);
  const data = {
    state,
    startedAt: deployment.startedAt || now,
    finishedAt: terminal ? now : null,
    backupPath: input.backupPath ? String(input.backupPath).slice(0, 1000) : deployment.backupPath,
    errorCode: input.errorCode ? String(input.errorCode).slice(0, 120) : null,
    errorMessage: input.errorMessage ? String(input.errorMessage).slice(0, 2000) : null,
    evidence: input.evidence && typeof input.evidence === 'object' ? input.evidence : undefined
  };
  const updated = await prisma.edgeDeployment.update({ where: { id: deployment.id }, data });
  const installation = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId: agent.id } });
  if (installation) {
    const installData = { updaterState: state };
    if (state === 'BACKUP') installData.lastBackupAt = now;
    if (state === 'SUCCESS') {
      installData.softwareVersion = deployment.targetVersion;
      installData.desiredVersion = null;
      installData.lastUpdateAt = now;
      installData.healthStatus = 'OK';
      installData.rollbackVersion = deployment.previousVersion || null;
    }
    if (state === 'ROLLED_BACK') {
      installData.softwareVersion = deployment.previousVersion || installation.softwareVersion;
      installData.desiredVersion = null;
      installData.lastUpdateAt = now;
      installData.healthStatus = 'OK';
    }
    if (state === 'FAILED') installData.healthStatus = 'UPDATE_FAILED';
    await prisma.edgeInstallation.update({ where: { edgeAgentId: agent.id }, data: installData });
  }
  if (state === 'SUCCESS') await prisma.edgeAgent.update({ where: { id: agent.id }, data: { softwareVersion: deployment.targetVersion, lastSeenAt: now } });
  return updated;
}

async function createRelayRequest(tenantId, edgeAgentId, action, requestBody, ttlSeconds = 90) {
  await requireAgent(tenantId, edgeAgentId);
  const normalizedAction = String(action || '').trim().toUpperCase();
  if (!ALLOWED_RELAY_ACTIONS.has(normalizedAction)) throw new AppError(400, 'Acción Relay no permitida', 'EDGE_RELAY_ACTION_INVALID');
  const ttl = Math.min(Math.max(Number(ttlSeconds) || 90, 15), 300);
  return prisma.edgeRelayRequest.create({
    data: {
      tenantId,
      edgeAgentId,
      action: normalizedAction,
      requestBody: requestBody && typeof requestBody === 'object' ? requestBody : null,
      expiresAt: new Date(Date.now() + ttl * 1000)
    }
  });
}

async function getRelayRequest(tenantId, id) {
  const row = await prisma.edgeRelayRequest.findFirst({ where: { id, tenantId } });
  if (!row) throw new AppError(404, 'Solicitud Relay no encontrada', 'EDGE_RELAY_NOT_FOUND');
  return row;
}

async function pullRelayRequests(agent, limit = 20) {
  const now = new Date();
  await prisma.edgeRelayRequest.updateMany({
    where: { edgeAgentId: agent.id, state: { in: ['PENDING', 'CLAIMED'] }, expiresAt: { lt: now } },
    data: { state: 'EXPIRED', completedAt: now, errorCode: 'EDGE_RELAY_EXPIRED', errorMessage: 'La solicitud expiró antes de completarse' }
  });
  const rows = await prisma.edgeRelayRequest.findMany({
    where: { edgeAgentId: agent.id, state: 'PENDING', expiresAt: { gte: now } },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Math.max(Number(limit) || 20, 1), 50)
  });
  if (rows.length) {
    await prisma.edgeRelayRequest.updateMany({ where: { id: { in: rows.map((x) => x.id) }, state: 'PENDING' }, data: { state: 'CLAIMED', claimedAt: now } });
  }
  await prisma.edgeInstallation.updateMany({ where: { edgeAgentId: agent.id }, data: { relayConnected: true, lastRelayAt: now } });
  return rows.map((x) => ({ id: x.id, action: x.action, requestBody: x.requestBody, expiresAt: x.expiresAt }));
}

async function completeRelayRequest(agent, id, input = {}) {
  const row = await prisma.edgeRelayRequest.findFirst({ where: { id, edgeAgentId: agent.id, tenantId: agent.tenantId } });
  if (!row) throw new AppError(404, 'Solicitud Relay no encontrada', 'EDGE_RELAY_NOT_FOUND');
  if (['COMPLETED', 'FAILED', 'EXPIRED'].includes(row.state)) return row;
  const ok = input.ok !== false;
  const now = new Date();
  const updated = await prisma.edgeRelayRequest.update({
    where: { id },
    data: {
      state: ok ? 'COMPLETED' : 'FAILED',
      responseBody: input.response && typeof input.response === 'object' ? input.response : null,
      errorCode: ok ? null : String(input.errorCode || 'EDGE_RELAY_FAILED').slice(0, 120),
      errorMessage: ok ? null : String(input.errorMessage || 'Relay local falló').slice(0, 2000),
      completedAt: now
    }
  });
  await prisma.edgeInstallation.updateMany({ where: { edgeAgentId: agent.id }, data: { relayConnected: true, lastRelayAt: now } });
  return updated;
}

async function createRemoteChannel(tenantId, edgeAgentId, input) {
  await requireAgent(tenantId, edgeAgentId);
  const type = String(input.type || '').trim().toUpperCase();
  if (!['MESA', 'DOMICILIO', 'RECOGER'].includes(type)) throw new AppError(400, 'Tipo de canal remoto inválido', 'EDGE_REMOTE_CHANNEL_INVALID');
  let tableId = input.tableId || null;
  if (type === 'MESA') {
    if (!tableId) throw new AppError(400, 'El canal Mesa requiere tableId', 'EDGE_REMOTE_TABLE_REQUIRED');
    const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  } else tableId = null;
  const token = newToken();
  const channel = await prisma.edgeRemoteChannel.create({
    data: {
      tenantId,
      edgeAgentId,
      type,
      name: String(input.name || type).trim().slice(0, 120),
      tableId,
      tokenHash: sha256(token)
    }
  });
  return { ...channel, token, publicPath: `/edge/remote/${token}` };
}

async function listRemoteChannels(tenantId) {
  return prisma.edgeRemoteChannel.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { creadoEn: 'desc' }] });
}

async function rotateRemoteChannel(tenantId, id) {
  const channel = await prisma.edgeRemoteChannel.findFirst({ where: { id, tenantId, active: true } });
  if (!channel) throw new AppError(404, 'Canal remoto no encontrado', 'EDGE_REMOTE_CHANNEL_NOT_FOUND');
  const token = newToken();
  const updated = await prisma.edgeRemoteChannel.update({ where: { id }, data: { tokenHash: sha256(token) } });
  return { ...updated, token, publicPath: `/edge/remote/${token}` };
}

async function remoteChannelByToken(token) {
  const hash = sha256(token);
  const channel = await prisma.edgeRemoteChannel.findUnique({ where: { tokenHash: hash } });
  if (!channel?.active) throw new AppError(404, 'Canal remoto no encontrado o inactivo', 'EDGE_REMOTE_CHANNEL_NOT_FOUND');
  return channel;
}

function normalizeMenuItem(item) {
  return {
    id: item.id,
    category: item.category,
    station: item.station,
    available: Boolean(item.product && (!item.requiresRecipe || item.recipeConfigured)),
    product: item.product ? {
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.nombre,
      price: Number(item.product.precio1 || 0),
      ivaPct: Number(item.product.ivaPct || 0),
      impoconsumoPct: Number(item.product.impoconsumoPct || 0)
    } : null
  };
}

async function getRemoteContext(token) {
  const channel = await remoteChannelByToken(token);
  const [tenant, menu, table] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: channel.tenantId }, select: { id: true, nombreEmpresa: true, logoUrl: true, moneda: true, pais: true } }),
    restaurant.listMenu(channel.tenantId, { active: true }),
    channel.tableId ? prisma.restaurantTable.findFirst({ where: { id: channel.tableId, tenantId: channel.tenantId, active: true }, select: { id: true, code: true, name: true, state: true } }) : null
  ]);
  return {
    tenant,
    channel: { id: channel.id, type: channel.type, name: channel.name, table },
    menu: menu.map(normalizeMenuItem)
  };
}

async function createRemoteOrder(token, input = {}) {
  const channel = await remoteChannelByToken(token);
  const menu = await restaurant.listMenu(channel.tenantId, { active: true });
  const byId = new Map(menu.map((x) => [x.id, x]));
  const requested = Array.isArray(input.items) ? input.items : [];
  if (!requested.length || requested.length > 100) throw new AppError(400, 'El pedido remoto requiere entre 1 y 100 ítems', 'EDGE_REMOTE_ORDER_ITEMS_REQUIRED');
  const items = [];
  let total = 0;
  for (const row of requested) {
    const menuItem = byId.get(String(row.menuItemId || ''));
    const quantity = Number(row.quantity || 0);
    if (!menuItem?.product || !quantity || quantity <= 0 || quantity > 999 || (menuItem.requiresRecipe && !menuItem.recipeConfigured)) {
      throw new AppError(400, 'Ítem remoto inválido o no disponible', 'EDGE_REMOTE_ORDER_ITEM_INVALID');
    }
    const price = Number(menuItem.product.precio1 || 0);
    const subtotal = price * quantity;
    const lineTotal = subtotal + subtotal * Number(menuItem.product.ivaPct || 0) / 100 + subtotal * Number(menuItem.product.impoconsumoPct || 0) / 100;
    total += lineTotal;
    items.push({
      menuItemId: menuItem.id,
      productId: menuItem.product.id,
      name: menuItem.product.nombre,
      station: menuItem.station,
      quantity,
      unitPrice: price,
      notes: row.notes ? String(row.notes).slice(0, 300) : null
    });
  }
  if (channel.type === 'DOMICILIO' && !String(input.deliveryAddress || '').trim()) {
    throw new AppError(400, 'Domicilio requiere dirección de entrega', 'EDGE_REMOTE_DELIVERY_ADDRESS_REQUIRED');
  }
  const paymentMode = String(input.paymentMode || 'CASH').toUpperCase();
  if (!['CASH', 'MANUAL_EXTERNAL_PENDING'].includes(paymentMode)) throw new AppError(400, 'Forma de pago remota no soportada', 'EDGE_REMOTE_PAYMENT_INVALID');
  const initialState = channel.type === 'MESA' ? 'APPROVED' : 'PENDING_CONFIRMATION';
  return prisma.edgeRemoteOrder.create({
    data: {
      tenantId: channel.tenantId,
      edgeAgentId: channel.edgeAgentId,
      remoteChannelId: channel.id,
      channelType: channel.type,
      state: initialState,
      customerName: input.customerName ? String(input.customerName).slice(0, 120) : null,
      customerPhone: input.customerPhone ? String(input.customerPhone).slice(0, 40) : null,
      deliveryAddress: input.deliveryAddress ? String(input.deliveryAddress).slice(0, 300) : null,
      notes: input.notes ? String(input.notes).slice(0, 500) : null,
      items,
      quotedTotal: Number(total.toFixed(2)),
      paymentMode,
      acceptedAt: initialState === 'APPROVED' ? new Date() : null
    }
  });
}

async function listRemoteOrders(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.state) where.state = String(filters.state).toUpperCase();
  if (filters.edgeAgentId) where.edgeAgentId = filters.edgeAgentId;
  if (filters.channelType) where.channelType = String(filters.channelType).toUpperCase();
  return prisma.edgeRemoteOrder.findMany({ where, orderBy: { creadoEn: 'desc' }, take: 500 });
}

async function decideRemoteOrder(tenantId, id, decision) {
  const order = await prisma.edgeRemoteOrder.findFirst({ where: { id, tenantId } });
  if (!order) throw new AppError(404, 'Pedido remoto no encontrado', 'EDGE_REMOTE_ORDER_NOT_FOUND');
  if (order.state !== 'PENDING_CONFIRMATION') throw new AppError(409, 'El pedido remoto ya fue decidido', 'EDGE_REMOTE_ORDER_ALREADY_DECIDED');
  const state = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : null;
  if (!state) throw new AppError(400, 'Decisión remota inválida', 'EDGE_REMOTE_ORDER_DECISION_INVALID');
  return prisma.edgeRemoteOrder.update({
    where: { id },
    data: state === 'APPROVED' ? { state, acceptedAt: new Date() } : { state, rejectedAt: new Date() }
  });
}

async function pullRemoteOrders(agent, limit = 50) {
  return prisma.edgeRemoteOrder.findMany({
    where: { edgeAgentId: agent.id, tenantId: agent.tenantId, state: 'APPROVED', localOperationId: null },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100)
  });
}

async function reportRemoteOrder(agent, id, input = {}) {
  const order = await prisma.edgeRemoteOrder.findFirst({ where: { id, edgeAgentId: agent.id, tenantId: agent.tenantId } });
  if (!order) throw new AppError(404, 'Pedido remoto no encontrado', 'EDGE_REMOTE_ORDER_NOT_FOUND');
  const state = String(input.state || order.state).toUpperCase();
  if (state !== order.state) {
    const allowed = REMOTE_ORDER_TRANSITIONS[order.state];
    if (!allowed?.has(state)) throw new AppError(409, `Transición remota inválida ${order.state} → ${state}`, 'EDGE_REMOTE_ORDER_TRANSITION_INVALID');
  }
  const now = new Date();
  const data = {
    state,
    localOperationId: input.localOperationId ? String(input.localOperationId).slice(0, 120) : order.localOperationId,
    originDocumentId: input.originDocumentId ? String(input.originDocumentId).slice(0, 120) : order.originDocumentId
  };
  if (state === 'APPROVED' && !order.acceptedAt) data.acceptedAt = now;
  if (state === 'READY') data.readyAt = now;
  if (['DELIVERED', 'PICKED_UP'].includes(state)) data.completedAt = now;
  if (state === 'REJECTED') data.rejectedAt = now;
  return prisma.edgeRemoteOrder.update({ where: { id }, data });
}

module.exports = {
  ALLOWED_RELAY_ACTIONS,
  heartbeat,
  listInstallations,
  setReleaseChannel,
  createRelease,
  listReleases,
  requestDeployment,
  updateManifest,
  reportDeployment,
  createRelayRequest,
  getRelayRequest,
  pullRelayRequests,
  completeRelayRequest,
  createRemoteChannel,
  listRemoteChannels,
  rotateRemoteChannel,
  getRemoteContext,
  createRemoteOrder,
  listRemoteOrders,
  decideRemoteOrder,
  pullRemoteOrders,
  reportRemoteOrder,
  heartbeatOnline
};
