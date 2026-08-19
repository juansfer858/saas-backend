async function auditInTx(tx, { tenantId, userId, entidad, entidadId, accion, metadata }) {
  if (!tenantId || !userId || !entidad || !entidadId || !accion) return null;
  return tx.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad,
      entidadId,
      accion,
      metadata: metadata || undefined
    }
  });
}

async function listAudit(client, tenantId, entidad, entidadId, limit = 100) {
  return client.auditoriaContable.findMany({
    where: { tenantId, entidad, entidadId },
    include: { user: { select: { id: true, nombre: true, email: true, rol: true } } },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Number(limit) || 100, 500)
  });
}

module.exports = { auditInTx, listAudit };
