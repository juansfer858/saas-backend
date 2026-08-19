const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

async function createUser(tenantId, input) {
  const password = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.user.create({
      data: {
        tenantId,
        nombre: input.nombre,
        email: input.email,
        password,
        rol: input.rol,
        activo: input.activo
      },
      select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El email ya existe en esta empresa', 'USER_EMAIL_EXISTS');
    throw error;
  }
}

async function listUsers(tenantId) {
  return prisma.user.findMany({
    where: { tenantId },
    select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
    orderBy: { nombre: 'asc' }
  });
}

async function updateUser(tenantId, id, input) {
  const current = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!current) throw new AppError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');

  const data = { ...input };
  if (data.password) data.password = await bcrypt.hash(data.password, 12);

  try {
    return await prisma.user.update({
      where: { id },
      data,
      select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true }
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'El email ya existe en esta empresa', 'USER_EMAIL_EXISTS');
    throw error;
  }
}

module.exports = { createUser, listUsers, updateUser };
