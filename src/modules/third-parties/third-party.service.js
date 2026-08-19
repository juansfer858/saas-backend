const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

async function create(tenantId, input) {
  try {
    return await prisma.tercero.create({
      data: { tenantId, ...input }
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'La identificación ya existe en esta empresa', 'THIRD_PARTY_EXISTS');
    }
    throw error;
  }
}

async function list(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.activo !== undefined) where.activo = filters.activo;
  if (filters.q) {
    where.OR = [
      { nombre: { contains: filters.q, mode: 'insensitive' } },
      { razonSocial: { contains: filters.q, mode: 'insensitive' } },
      { identificacion: { contains: filters.q, mode: 'insensitive' } }
    ];
  }

  return prisma.tercero.findMany({
    where,
    orderBy: { nombre: 'asc' },
    take: Math.min(Number(filters.limit) || 100, 500)
  });
}

async function getById(tenantId, id) {
  const tercero = await prisma.tercero.findFirst({ where: { id, tenantId } });
  if (!tercero) throw new AppError(404, 'Tercero no encontrado', 'THIRD_PARTY_NOT_FOUND');
  return tercero;
}

async function update(tenantId, id, input) {
  await getById(tenantId, id);
  try {
    return await prisma.tercero.update({
      where: { id },
      data: input
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'La identificación ya existe en esta empresa', 'THIRD_PARTY_EXISTS');
    }
    throw error;
  }
}

async function deactivate(tenantId, id) {
  await getById(tenantId, id);
  return prisma.tercero.update({ where: { id }, data: { activo: false } });
}

module.exports = { create, list, getById, update, deactivate };
