'use strict';

const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const registry = require('./vertical-registry');

async function tenantExists(client, tenantId) {
  return Boolean(await client.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }));
}

async function activateWithClient(client, tenantId, verticalValue, options = {}) {
  const vertical = registry.requireAvailableVertical(verticalValue);
  if (!(await tenantExists(client, tenantId))) throw new AppError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');
  return client.tenantVerticalEntitlement.upsert({
    where: { tenantId_verticalCode: { tenantId, verticalCode: vertical.code } },
    create: {
      tenantId,
      verticalCode: vertical.code,
      state: 'ACTIVE',
      source: options.source || 'PLATFORM',
      metadata: options.metadata || undefined
    },
    update: {
      state: 'ACTIVE',
      source: options.source || 'PLATFORM',
      metadata: options.metadata || undefined,
      activatedAt: new Date(),
      suspendedAt: null
    }
  });
}

async function suspendWithClient(client, tenantId, verticalValue, options = {}) {
  const vertical = registry.getVertical(verticalValue);
  if (!vertical) throw new AppError(400, 'Vertical VantixGC inválido', 'VERTICAL_INVALID');
  const current = await client.tenantVerticalEntitlement.findUnique({
    where: { tenantId_verticalCode: { tenantId, verticalCode: vertical.code } }
  });
  if (!current) throw new AppError(404, 'Entitlement vertical no encontrado', 'VERTICAL_ENTITLEMENT_NOT_FOUND');
  return client.tenantVerticalEntitlement.update({
    where: { id: current.id },
    data: { state: 'SUSPENDED', suspendedAt: new Date(), metadata: options.metadata || current.metadata }
  });
}

async function ensureLegacyEntitlements(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nicho: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND');

  const existing = await client.tenantVerticalEntitlement.findMany({ where: { tenantId } });
  if (existing.length) return existing;

  const legacyCode = registry.normalizeVerticalCode(tenant.nicho);
  if (legacyCode && registry.getVertical(legacyCode)?.state === 'AVAILABLE') {
    await activateWithClient(client, tenantId, legacyCode, { source: 'LEGACY_NICHO_MIGRATION', metadata: { legacyNicho: tenant.nicho } });
  } else {
    const restaurantConfig = await client.restaurantConfig.findUnique({ where: { tenantId }, select: { tenantId: true } });
    if (restaurantConfig) {
      await activateWithClient(client, tenantId, 'RESTAURANT', { source: 'LEGACY_RESTAURANT_CONFIG', metadata: { inferred: true } });
    }
  }
  return client.tenantVerticalEntitlement.findMany({ where: { tenantId } });
}

async function listTenantEntitlements(tenantId, options = {}) {
  if (options.ensureLegacy !== false) await ensureLegacyEntitlements(tenantId);
  const rows = await prisma.tenantVerticalEntitlement.findMany({ where: { tenantId }, orderBy: { verticalCode: 'asc' } });
  return rows.map((row) => ({
    ...row,
    vertical: registry.getVertical(row.verticalCode)
  }));
}

async function activeVerticals(tenantId) {
  const rows = await listTenantEntitlements(tenantId);
  return rows
    .filter((row) => row.state === 'ACTIVE' && row.vertical?.state === 'AVAILABLE')
    .map((row) => row.vertical);
}

async function hasVertical(tenantId, verticalValue) {
  const vertical = registry.getVertical(verticalValue);
  if (!vertical) return false;
  await ensureLegacyEntitlements(tenantId);
  const row = await prisma.tenantVerticalEntitlement.findUnique({
    where: { tenantId_verticalCode: { tenantId, verticalCode: vertical.code } },
    select: { state: true }
  });
  return row?.state === 'ACTIVE';
}

async function activate(tenantId, verticalValue, options = {}) {
  return activateWithClient(prisma, tenantId, verticalValue, options);
}

async function suspend(tenantId, verticalValue, options = {}) {
  return suspendWithClient(prisma, tenantId, verticalValue, options);
}

async function setFromPlatform(superAdminId, tenantId, verticalValue, active, metadata = null) {
  const vertical = registry.getVertical(verticalValue);
  if (!vertical) throw new AppError(400, 'Vertical VantixGC inválido', 'VERTICAL_INVALID');
  if (active && vertical.state !== 'AVAILABLE') throw new AppError(409, 'Ese vertical todavía no está disponible para activación', 'VERTICAL_NOT_AVAILABLE');

  return prisma.$transaction(async (tx) => {
    const admin = await tx.platformSuperAdmin.findFirst({ where: { id: superAdminId, active: true }, select: { id: true } });
    if (!admin) throw new AppError(401, 'Super-administrador de plataforma no válido', 'PLATFORM_AUTH_INVALID');
    const row = active
      ? await activateWithClient(tx, tenantId, vertical.code, { source: 'PLATFORM_ADMIN', metadata: metadata || undefined })
      : await suspendWithClient(tx, tenantId, vertical.code, { metadata: metadata || undefined });

    await tx.platformAudit.create({
      data: {
        superAdminId,
        action: active ? 'VERTICAL_ENTITLEMENT_ACTIVATE' : 'VERTICAL_ENTITLEMENT_SUSPEND',
        entity: 'TENANT_VERTICAL_ENTITLEMENT',
        entityId: row.id,
        tenantId,
        metadata: { verticalCode: vertical.code, active, metadata }
      }
    });
    return { ...row, vertical };
  });
}

async function edgeManifest(tenantId) {
  const verticals = await activeVerticals(tenantId);
  return {
    core: {
      code: 'CORE',
      label: 'VantixGC Core Universal',
      runtime: 'EDGE_UNIVERSAL_V1'
    },
    verticals: verticals.map((vertical) => ({
      code: vertical.code,
      label: vertical.label,
      localFirst: vertical.localFirst,
      edgeAdapter: vertical.edgeAdapter,
      edgeWorkspace: vertical.edgeWorkspace,
      cloudAppPath: vertical.cloudAppPath,
      capabilities: [...vertical.capabilities]
    }))
  };
}

module.exports = {
  activateWithClient,
  suspendWithClient,
  ensureLegacyEntitlements,
  listTenantEntitlements,
  activeVerticals,
  hasVertical,
  activate,
  suspend,
  setFromPlatform,
  edgeManifest
};
