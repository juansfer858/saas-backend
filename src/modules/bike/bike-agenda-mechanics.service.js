'use strict';

const { prisma } = require('../../config/prisma');

async function listMechanics(tenantId) {
  return prisma.user.findMany({
    where: { tenantId, activo: true },
    select: { id: true, nombre: true, email: true, rol: true },
    orderBy: [{ nombre: 'asc' }, { email: 'asc' }]
  });
}

module.exports = { listMechanics };
