'use strict';

const { prisma } = require('../../config/prisma');

async function cashShiftState(tenantId, userId) {
  const openShifts = await prisma.aperturaCierreCaja.findMany({
    where: { tenantId, estado: 'ABIERTA' },
    include: {
      cajaBanco: { select: { id: true, nombre: true, tipo: true, activo: true } },
      user: { select: { id: true, nombre: true, rol: true } }
    },
    orderBy: { abiertoEn: 'desc' }
  });

  const rows = openShifts.map((row) => ({
    id: row.id,
    cajaBancoId: row.cajaBancoId,
    userId: row.userId,
    abiertoEn: row.abiertoEn,
    cajaBanco: row.cajaBanco,
    user: row.user,
    ownedByCurrentUser: row.userId === userId
  }));

  return {
    ownShift: rows.find((row) => row.ownedByCurrentUser) || null,
    openShifts: rows
  };
}

module.exports = { cashShiftState };
