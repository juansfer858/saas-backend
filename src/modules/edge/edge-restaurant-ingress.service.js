'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

// Keep this aligned with the Core's existing Edge online definition.
// Edge heartbeats every 15 s and the platform considers it online for 90 s.
const EDGE_HEARTBEAT_ONLINE_MS = 90_000;

function heartbeatOnline(lastHeartbeatAt, now = Date.now()) {
  if (!lastHeartbeatAt) return false;
  const timestamp = new Date(lastHeartbeatAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp <= EDGE_HEARTBEAT_ONLINE_MS;
}

function privateLanHost(value) {
  const host = String(value || '').trim().replace(/^\[|\]$/g, '');
  if (!host) return null;
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return host;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return host;
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) return host;
  if (/^(?:127|169\.254)(?:\.\d{1,3}){3}$/.test(host)) return host;
  if (/^(?:fc|fd)[0-9a-f:]+$/i.test(host) || /^fe[89ab][0-9a-f:]+$/i.test(host)) return host;
  return null;
}

function lanFallbackUrl(qrToken, installation) {
  const host = privateLanHost(installation?.lanHost);
  const port = Number(installation?.lanPort || 8788);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const displayHost = host.includes(':') ? `[${host}]` : host;
  return `http://${displayHost}:${port}/r/${encodeURIComponent(String(qrToken || ''))}?mode=lan`;
}

async function installationFor(client, edgeAgentId) {
  if (!edgeAgentId) return null;
  return client.edgeInstallation.findUnique({
    where: { edgeAgentId },
    select: { edgeAgentId: true, lastHeartbeatAt: true, healthStatus: true, lanHost: true, lanPort: true }
  });
}

function managedStatus(qrToken, edgeAgentId, source, installation, now) {
  return {
    managedByEdge: true,
    available: heartbeatOnline(installation?.lastHeartbeatAt, now),
    source,
    edgeAgentId,
    localFallbackUrl: lanFallbackUrl(qrToken, installation)
  };
}

async function qrOrderIngressStatus(qrToken, options = {}) {
  const client = options.client || prisma;
  const now = options.now == null ? Date.now() : Number(options.now);
  const token = String(qrToken || '').trim();
  if (!token) return { managedByEdge: false, available: true, source: 'QR_TOKEN_MISSING', localFallbackUrl: null };

  const table = await client.restaurantTable.findUnique({
    where: { qrToken: token },
    select: { id: true, tenantId: true, active: true }
  });
  if (!table?.active) return { managedByEdge: false, available: true, source: 'TABLE_NOT_ACTIVE', localFallbackUrl: null };

  // A table-specific remote channel is the strongest available mapping to one Edge.
  // It wins even when the tenant has multiple Edge points.
  const mappedChannel = await client.edgeRemoteChannel.findFirst({
    where: { tenantId: table.tenantId, tableId: table.id, type: 'MESA', active: true },
    orderBy: { creadoEn: 'desc' },
    select: { edgeAgentId: true }
  });
  if (mappedChannel?.edgeAgentId) {
    const installation = await installationFor(client, mappedChannel.edgeAgentId);
    return managedStatus(token, mappedChannel.edgeAgentId, 'TABLE_EDGE_CHANNEL', installation, now);
  }

  // Most restaurant tenants have one Edge point. If that Edge has never completed
  // a heartbeat we do not change existing cloud behaviour during onboarding.
  // Once an installation exists, a stale heartbeat means the restaurant may be
  // operating locally and customer QR orders must fail closed instead of becoming
  // invisible to the local KDS.
  const agents = await client.edgeAgent.findMany({
    where: { tenantId: table.tenantId, state: 'ACTIVE' },
    orderBy: { creadoEn: 'asc' },
    take: 2,
    select: { id: true }
  });
  if (agents.length !== 1) {
    return {
      managedByEdge: false,
      available: true,
      source: agents.length > 1 ? 'EDGE_TOPOLOGY_AMBIGUOUS' : 'NO_ACTIVE_EDGE',
      localFallbackUrl: null
    };
  }

  const installation = await installationFor(client, agents[0].id);
  if (!installation) {
    return { managedByEdge: false, available: true, source: 'EDGE_NOT_INSTALLED', localFallbackUrl: null };
  }
  return managedStatus(token, agents[0].id, 'SINGLE_EDGE_INSTALLATION', installation, now);
}

async function assertQrOrderIngressAvailable(qrToken, options = {}) {
  const status = await qrOrderIngressStatus(qrToken, options);
  if (status.managedByEdge && !status.available) {
    throw new AppError(
      503,
      'El restaurante está trabajando temporalmente sin conexión. Este pedido no se envió. Conéctate al Wi-Fi del restaurante para continuar en modo local o pídele al mesero que lo registre desde su tablet.',
      'RESTAURANT_QR_EDGE_OFFLINE',
      { localFallbackUrl: status.localFallbackUrl || null }
    );
  }
  return status;
}

module.exports = {
  EDGE_HEARTBEAT_ONLINE_MS,
  heartbeatOnline,
  privateLanHost,
  lanFallbackUrl,
  qrOrderIngressStatus,
  assertQrOrderIngressAvailable
};
