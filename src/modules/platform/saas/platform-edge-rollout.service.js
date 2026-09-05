'use strict';

const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const ACTIVE_STATES = ['PENDING', 'DOWNLOADING', 'BACKUP', 'INSTALLING', 'HEALTHCHECK'];
const CHANNELS = new Set(['PILOT', 'STABLE']);

function isOnline(lastHeartbeatAt, now = Date.now()) {
  return Boolean(lastHeartbeatAt && now - new Date(lastHeartbeatAt).getTime() <= 90000);
}

async function audit(superAdminId, action, entity, entityId = null, tenantId = null, metadata = null, client = prisma) {
  return client.platformAudit.create({ data: { superAdminId, action, entity, entityId, tenantId, metadata } });
}

async function listOverview() {
  const [releases, installations, agents, tenants, deployments, updateChecks] = await Promise.all([
    prisma.edgeRelease.findMany({ where: { tenantId: null, enabled: true }, orderBy: { creadoEn: 'desc' }, take: 100 }),
    prisma.edgeInstallation.findMany({ orderBy: { actualizadoEn: 'desc' } }),
    prisma.edgeAgent.findMany({ orderBy: [{ tenantId: 'asc' }, { pointCode: 'asc' }] }),
    prisma.tenant.findMany({ select: { id: true, nombreEmpresa: true, subdomain: true, activo: true } }),
    prisma.edgeDeployment.findMany({ where: { state: { in: ACTIVE_STATES } }, orderBy: { requestedAt: 'desc' } }),
    prisma.edgeRelayRequest.findMany({ where: { action: 'UPDATE_CHECK' }, orderBy: { creadoEn: 'desc' }, take: 200 })
  ]);
  const byAgent = new Map(agents.map((row) => [row.id, row]));
  const byTenant = new Map(tenants.map((row) => [row.id, row]));
  const activeByAgent = new Map();
  for (const row of deployments) if (!activeByAgent.has(row.edgeAgentId)) activeByAgent.set(row.edgeAgentId, row);
  const updateCheckByAgent = new Map();
  for (const row of updateChecks) if (!updateCheckByAgent.has(row.edgeAgentId)) updateCheckByAgent.set(row.edgeAgentId, row);
  const now = Date.now();
  return {
    releases,
    installations: installations.map((installation) => {
      const agent = byAgent.get(installation.edgeAgentId) || null;
      const tenant = byTenant.get(installation.tenantId) || null;
      return {
        installation: { ...installation, online: isOnline(installation.lastHeartbeatAt, now) },
        agent,
        tenant,
        deployment: activeByAgent.get(installation.edgeAgentId) || null,
        updateCheck: updateCheckByAgent.get(installation.edgeAgentId) || null
      };
    })
  };
}

async function createGlobalRelease(superAdminId, input) {
  const version = String(input.version || '').trim();
  const channel = String(input.channel || 'PILOT').trim().toUpperCase();
  const artifactUrl = String(input.artifactUrl || '').trim();
  const sha256 = String(input.sha256 || '').trim().toLowerCase();
  if (!version || !artifactUrl || !/^[a-f0-9]{64}$/.test(sha256)) throw new AppError(400, 'Versión, URL y SHA-256 válidos son obligatorios', 'PLATFORM_EDGE_RELEASE_INVALID');
  if (!CHANNELS.has(channel)) throw new AppError(400, 'Canal Edge inválido', 'PLATFORM_EDGE_CHANNEL_INVALID');
  let release;
  try {
    release = await prisma.edgeRelease.create({
      data: {
        tenantId: null,
        version,
        channel,
        artifactUrl,
        sha256,
        releaseNotes: input.releaseNotes ? String(input.releaseNotes).slice(0, 5000) : null,
        minCoreVersion: input.minCoreVersion ? String(input.minCoreVersion).slice(0, 80) : null,
        mandatory: Boolean(input.mandatory),
        enabled: input.enabled !== false,
        createdByUserId: null
      }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'Ya existe esa versión Edge global', 'PLATFORM_EDGE_RELEASE_DUPLICATE');
    throw error;
  }
  await audit(superAdminId, 'EDGE_GLOBAL_RELEASE_CREATE', 'EDGE_RELEASE', release.id, null, { version, channel, artifactUrl, sha256, autoRollout: input.autoRollout !== false });
  const rollout = input.autoRollout === false ? null : await rolloutRelease(superAdminId, release.id, { scope: 'CHANNEL' });
  return { release, rollout };
}

async function requireGlobalRelease(releaseId) {
  const release = await prisma.edgeRelease.findFirst({ where: { id: releaseId, tenantId: null, enabled: true } });
  if (!release) throw new AppError(404, 'Release Edge global no encontrado', 'PLATFORM_EDGE_RELEASE_NOT_FOUND');
  return release;
}

async function scheduleInstallation(release, installation) {
  if (installation.softwareVersion === release.version) return { status: 'ALREADY_CURRENT', edgeAgentId: installation.edgeAgentId };
  const active = await prisma.edgeDeployment.findFirst({ where: { tenantId: installation.tenantId, edgeAgentId: installation.edgeAgentId, state: { in: ACTIVE_STATES } } });
  if (active) return { status: 'ACTIVE_DEPLOYMENT', edgeAgentId: installation.edgeAgentId, deploymentId: active.id };
  const deployment = await prisma.edgeDeployment.create({
    data: {
      tenantId: installation.tenantId,
      edgeAgentId: installation.edgeAgentId,
      installationId: installation.installationId,
      releaseId: release.id,
      targetVersion: release.version,
      requestedByUserId: null,
      previousVersion: installation.softwareVersion || null
    }
  });
  await prisma.edgeInstallation.update({ where: { edgeAgentId: installation.edgeAgentId }, data: { desiredVersion: release.version, updaterState: 'PENDING' } });
  const updateCheck = await prisma.edgeRelayRequest.create({
    data: {
      tenantId: installation.tenantId,
      edgeAgentId: installation.edgeAgentId,
      action: 'UPDATE_CHECK',
      requestBody: { reason: 'PLATFORM_EDGE_DEPLOY_NOW', deploymentId: deployment.id, targetVersion: release.version },
      expiresAt: new Date(Date.now() + 300000)
    }
  });
  return { status: 'SCHEDULED', edgeAgentId: installation.edgeAgentId, deploymentId: deployment.id, updateCheckId: updateCheck.id };
}

async function rolloutRelease(superAdminId, releaseId, options = {}) {
  const release = await requireGlobalRelease(releaseId);
  const scope = String(options.scope || 'CHANNEL').toUpperCase();
  const where = scope === 'ALL' ? {} : { releaseChannel: release.channel };
  const installations = await prisma.edgeInstallation.findMany({ where, orderBy: { creadoEn: 'asc' } });
  const results = [];
  for (const installation of installations) results.push(await scheduleInstallation(release, installation));
  const summary = results.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  await audit(superAdminId, 'EDGE_GLOBAL_ROLLOUT', 'EDGE_RELEASE', release.id, null, { version: release.version, channel: release.channel, scope, installations: installations.length, summary });
  return { release, scope, summary, results };
}

async function deployOne(superAdminId, edgeAgentId, releaseId) {
  const release = await requireGlobalRelease(releaseId);
  const installation = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId } });
  if (!installation) throw new AppError(404, 'Instalación Edge no encontrada', 'PLATFORM_EDGE_INSTALLATION_NOT_FOUND');
  const result = await scheduleInstallation(release, installation);
  await audit(superAdminId, 'EDGE_INSTALLATION_DEPLOY', 'EDGE_INSTALLATION', installation.id, installation.tenantId, { releaseId: release.id, version: release.version, result });
  return { release, installation, result };
}

async function cancelActiveDeployment(superAdminId, edgeAgentId, reason = null) {
  const installation = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId } });
  if (!installation) throw new AppError(404, 'Instalación Edge no encontrada', 'PLATFORM_EDGE_INSTALLATION_NOT_FOUND');
  const active = await prisma.edgeDeployment.findFirst({
    where: { tenantId: installation.tenantId, edgeAgentId, state: { in: ACTIVE_STATES } },
    orderBy: { requestedAt: 'desc' }
  });
  if (!active) return { status: 'NO_ACTIVE_DEPLOYMENT', installation };
  const message = String(reason || 'Cancelado desde SaaS Master para recuperar un despliegue atascado').slice(0, 1000);
  const result = await prisma.$transaction(async (tx) => {
    const deployment = await tx.edgeDeployment.update({
      where: { id: active.id },
      data: {
        state: 'CANCELED',
        finishedAt: new Date(),
        errorCode: 'PLATFORM_CANCELED',
        errorMessage: message
      }
    });
    const updatedInstallation = await tx.edgeInstallation.update({
      where: { edgeAgentId },
      data: { desiredVersion: null, updaterState: 'IDLE' }
    });
    await audit(superAdminId, 'EDGE_DEPLOYMENT_CANCEL', 'EDGE_DEPLOYMENT', deployment.id, installation.tenantId, {
      edgeAgentId,
      targetVersion: deployment.targetVersion,
      previousState: active.state,
      reason: message
    }, tx);
    return { deployment, installation: updatedInstallation };
  });
  return { status: 'CANCELED', ...result };
}

async function setInstallationChannel(superAdminId, edgeAgentId, channel) {
  const normalized = String(channel || '').toUpperCase();
  if (!CHANNELS.has(normalized)) throw new AppError(400, 'Canal Edge inválido', 'PLATFORM_EDGE_CHANNEL_INVALID');
  const current = await prisma.edgeInstallation.findUnique({ where: { edgeAgentId } });
  if (!current) throw new AppError(404, 'Instalación Edge no encontrada', 'PLATFORM_EDGE_INSTALLATION_NOT_FOUND');
  const updated = await prisma.edgeInstallation.update({ where: { edgeAgentId }, data: { releaseChannel: normalized } });
  await audit(superAdminId, 'EDGE_INSTALLATION_CHANNEL', 'EDGE_INSTALLATION', updated.id, updated.tenantId, { before: current.releaseChannel, after: normalized });
  return updated;
}

module.exports = {
  ACTIVE_STATES,
  listOverview,
  createGlobalRelease,
  rolloutRelease,
  deployOne,
  cancelActiveDeployment,
  setInstallationChannel
};
