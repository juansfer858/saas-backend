'use strict';

const { prisma } = require('../../../config/prisma');

function cleanId(value) {
  const id = value === undefined || value === null ? '' : String(value).trim();
  return id || null;
}

async function resolveAssignedRegisterIds(tenantId, userId, client = prisma) {
  const safeTenantId = cleanId(tenantId);
  const safeUserId = cleanId(userId);
  if (!safeTenantId || !safeUserId) return [];

  const rows = await client.aperturaCierreCaja.findMany({
    where: {
      tenantId: safeTenantId,
      userId: safeUserId,
      estado: 'ABIERTA',
      cajaBanco: {
        tipo: 'CAJA',
        activo: true
      }
    },
    select: {
      cajaBancoId: true
    },
    orderBy: {
      abiertoEn: 'desc'
    }
  });

  return [...new Set(rows.map((row) => cleanId(row.cajaBancoId)).filter(Boolean))];
}

async function hydrateAssignedRegisterScopeContext({ tenantId, userId, resourceTenantId, registerId }, client = prisma) {
  const actorTenantId = cleanId(tenantId);
  const actorUserId = cleanId(userId);
  const targetTenantId = cleanId(resourceTenantId);
  const targetRegisterId = cleanId(registerId);

  const assignedRegisterIds = await resolveAssignedRegisterIds(actorTenantId, actorUserId, client);

  return {
    actorTenantId,
    resourceTenantId: targetTenantId,
    actorUserId,
    registerId: targetRegisterId,
    assignedRegisterIds
  };
}

module.exports = {
  resolveAssignedRegisterIds,
  hydrateAssignedRegisterScopeContext
};
