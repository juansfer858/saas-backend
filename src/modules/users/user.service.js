const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

function assertRoleGovernance({ actorRole = null, actorUserId = null, current = null, input = {} }) {
  if (actorRole === 'ADMIN') {
    if (input.rol === 'SUPER_ADMIN' || current?.rol === 'SUPER_ADMIN') {
      throw new AppError(403, 'Sólo SUPER_ADMIN puede administrar cuentas SUPER_ADMIN', 'USER_ROLE_ESCALATION_FORBIDDEN');
    }
  }

  if (actorUserId && current?.id === actorUserId) {
    if (input.activo === false) {
      throw new AppError(400, 'No puedes desactivar tu propia cuenta', 'USER_SELF_DEACTIVATE_FORBIDDEN');
    }
    if (input.rol && input.rol !== current.rol) {
      throw new AppError(400, 'No puedes cambiar tu propio rol desde Usuarios', 'USER_SELF_ROLE_CHANGE_FORBIDDEN');
    }
  }
}

async function createUser(tenantId, input, options = {}) {
  assertRoleGovernance({ actorRole: options.actorRole || null, input });
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

async function updateUser(tenantId, id, input, options = {}) {
  const current = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!current) throw new AppError(404, 'Usuario no encontrado', 'USER_NOT_FOUND');

  assertRoleGovernance({
    actorRole: options.actorRole || null,
    actorUserId: options.actorUserId || null,
    current,
    input
  });

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

module.exports = { createUser, listUsers, updateUser, assertRoleGovernance };
