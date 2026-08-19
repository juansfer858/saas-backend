const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');
const { seedTenantDefaults } = require('../../services/tenant-seed.service');
const { seedPlatformDefaults } = require('../../services/platform-seed.service');

async function registerTenant(input) {
  const passwordHash = await bcrypt.hash(input.admin.password, 12);

  try {
    return await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          nit: input.nit || null,
          nombreEmpresa: input.nombreEmpresa,
          nicho: input.nicho,
          subdomain: input.subdomain,
          logoUrl: input.logoUrl || null,
          pais: input.pais,
          moneda: input.moneda
        },
        select: {
          id: true,
          nit: true,
          nombreEmpresa: true,
          nicho: true,
          subdomain: true,
          logoUrl: true,
          pais: true,
          moneda: true,
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

      await seedTenantDefaults(tx, tenant);
      await seedPlatformDefaults(tx, tenant, admin);

      return { tenant, admin };
    });
  } catch (error) {
    if (error && error.code === 'P2002') {
      throw new AppError(409, 'El subdominio o dato único ya está registrado', 'TENANT_UNIQUE_CONFLICT');
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
      rol: true,
      activo: true
    }
  });

  if (!user || !user.activo) {
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

  await prisma.platformTenantControl.upsert({
    where: { tenantId: user.tenantId },
    create: { tenantId: user.tenantId, planCode: 'CORE', lastAccessAt: new Date() },
    update: { lastAccessAt: new Date() }
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
