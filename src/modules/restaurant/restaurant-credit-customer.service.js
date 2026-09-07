'use strict';

const { prisma } = require('../../config/prisma');
const thirdParty = require('../third-parties/third-party.service');

const GENERIC_CUSTOMER_IDENTIFICATION = '222222222222';
const CREDIT_CUSTOMER_TYPES = ['CLIENTE', 'CLIENTE_PROVEEDOR'];

async function listCreditCustomers(tenantId, filters = {}) {
  const q = String(filters.q || '').trim();
  const where = {
    tenantId,
    activo: true,
    tipo: { in: CREDIT_CUSTOMER_TYPES },
    NOT: { identificacion: GENERIC_CUSTOMER_IDENTIFICATION }
  };
  if (q) {
    where.OR = [
      { nombre: { contains: q, mode: 'insensitive' } },
      { razonSocial: { contains: q, mode: 'insensitive' } },
      { identificacion: { contains: q, mode: 'insensitive' } },
      { telefono: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } }
    ];
  }
  return prisma.tercero.findMany({
    where,
    orderBy: [{ nombre: 'asc' }, { identificacion: 'asc' }],
    take: Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  });
}

async function createCreditCustomer(tenantId, input) {
  return thirdParty.create(tenantId, {
    tipo: 'CLIENTE',
    tipoDocumento: input.tipoDocumento,
    identificacion: input.identificacion,
    nombre: input.nombre,
    razonSocial: input.razonSocial || null,
    direccion: input.direccion || null,
    telefono: input.telefono || null,
    email: input.email || null,
    cupoCredito: Number(input.cupoCredito || 0),
    diasPlazo: Number(input.diasPlazo || 0),
    responsableIva: false,
    sujetoRetefuente: false,
    sujetoReteIca: false,
    sujetoReteIva: false,
    activo: true
  });
}

module.exports = {
  GENERIC_CUSTOMER_IDENTIFICATION,
  CREDIT_CUSTOMER_TYPES,
  listCreditCustomers,
  createCreditCustomer
};
