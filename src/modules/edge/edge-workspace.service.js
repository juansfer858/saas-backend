const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const rbac = require('../platform/rbac/rbac.service');

const GRANT_TTL_MS = Math.max(30000, Number(process.env.EDGE_LOCAL_GRANT_TTL_MS || 120000));

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function createLocalAccessGrant(tenantId, user, edgeAgentId) {
  if (!user?.id) throw new AppError(401, 'Usuario requerido', 'EDGE_LOCAL_USER_REQUIRED');
  const [tenant, agent, installation] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.edgeAgent.findFirst({ where: { id: edgeAgentId, tenantId, state: 'ACTIVE' } }),
    prisma.edgeInstallation.findUnique({ where: { edgeAgentId } })
  ]);
  if (!tenant?.activo) throw new AppError(404, 'Tenant no disponible', 'EDGE_LOCAL_TENANT_NOT_FOUND');
  if (!agent) throw new AppError(404, 'Edge Agent activo no encontrado', 'EDGE_AGENT_NOT_FOUND');
  if (!installation?.lanHost || !installation?.lanPort) throw new AppError(409, 'El Edge aún no reporta una dirección LAN utilizable', 'EDGE_LOCAL_LAN_NOT_READY');

  const permissions = [...await rbac.effectivePermissions(tenantId, user)];
  if (!(permissions.includes('*') || permissions.includes('RESTAURANTE.VER'))) {
    throw new AppError(403, 'El usuario no tiene acceso a Restaurante', 'EDGE_LOCAL_RESTAURANT_FORBIDDEN');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  const snapshot = {
    tenant: { id: tenant.id, nombreEmpresa: tenant.nombreEmpresa, subdomain: tenant.subdomain, moneda: tenant.moneda, pais: tenant.pais },
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    permissions,
    edge: { id: agent.id, pointCode: agent.pointCode, name: agent.name },
    issuedAt: new Date().toISOString()
  };

  await prisma.edgeLocalAccessGrant.create({
    data: { tenantId, edgeAgentId: agent.id, userId: user.id, tokenHash: tokenHash(token), snapshot, expiresAt }
  });

  const localOrigin = `http://${installation.lanHost}:${installation.lanPort}`;
  return {
    token,
    expiresAt,
    edgeAgentId: agent.id,
    installationId: installation.installationId,
    localOrigin,
    localUrl: `${localOrigin}/access?grant=${encodeURIComponent(token)}`
  };
}

async function consumeLocalAccessGrant(agent, token) {
  const hash = tokenHash(token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const grant = await tx.edgeLocalAccessGrant.findFirst({
      where: {
        tokenHash: hash,
        tenantId: agent.tenantId,
        edgeAgentId: agent.id,
        consumedAt: null,
        expiresAt: { gt: now }
      }
    });
    if (!grant) throw new AppError(401, 'Pase local inválido, vencido o ya utilizado', 'EDGE_LOCAL_GRANT_INVALID');
    await tx.edgeLocalAccessGrant.update({ where: { id: grant.id }, data: { consumedAt: now } });
    return grant.snapshot;
  });
}

module.exports = { createLocalAccessGrant, consumeLocalAccessGrant };
