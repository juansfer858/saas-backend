const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');

async function registerTenant(input) {
  const passwordHash = await bcrypt.hash(input.admin.password, 12);

  try {
    return await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          nombreEmpresa: input.nombreEmpresa,
          nicho: input.nicho,
          subdomain: input.subdomain
        },
        select: {
          id: true,
          nombreEmpresa: true,
          nicho: true,
          subdomain: true,
          creadoEn: true
        }
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          nombre: input.admin.nombre,
          email: input.admin.email,
          password: passwordHash,
          rol: 'ADMIN'
        },
        select: {
          id: true,
          tenantId: true,
          nombre: true,
          email: true,
          rol: true,
          creadoEn: true
        }
      });

      return { tenant, admin };
    });
  } catch (error) {
    if (error && error.code === 'P2002') {
      throw new AppError(409, 'El subdominio ya está registrado', 'TENANT_SUBDOMAIN_EXISTS');
    }
    throw error;
  }
}

async function login(tenantId, input) {
  const user = await prisma.user.findUnique({
    where: {
      tenantId_email: {
        tenantId,
        email: input.email
      }
    },
    select: {
      id: true,
      tenantId: true,
      nombre: true,
      email: true,
      password: true,
      rol: true
    }
  });

  if (!user) {
    throw new AppError(401, 'Credenciales inválidas', 'AUTH_INVALID_CREDENTIALS');
  }

  const passwordOk = await bcrypt.compare(input.password, user.password);
  if (!passwordOk) {
    throw new AppError(401, 'Credenciales inválidas', 'AUTH_INVALID_CREDENTIALS');
  }

  const token = signAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    rol: user.rol
  });

  return {
    token,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    }
  };
}

module.exports = {
  registerTenant,
  login
};
