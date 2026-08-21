const bcrypt = require('bcryptjs');
const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');
const { seedTenantDefaults } = require('../../../services/tenant-seed.service');
const { seedPlatformDefaults } = require('../../../services/platform-seed.service');

const TEMPLATE_DEFINITIONS = Object.freeze({
  CORE: { code: 'CORE', label: 'Core genérico', available: true, nicho: 'CORE' },
  RESTAURANTE: { code: 'RESTAURANTE', label: 'Restaurante', available: true, nicho: 'RESTAURANTE' },
  PAPELERIA: { code: 'PAPELERIA', label: 'Papelería', available: false, nicho: 'PAPELERIA', comingSoon: true }
});

function templates() {
  return Object.values(TEMPLATE_DEFINITIONS).map((x) => ({ ...x }));
}

function slugBase(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 52) || 'empresa';
}

async function allocateSubdomain(tx, businessName) {
  const base = slugBase(businessName);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const exists = await tx.tenant.findUnique({ where: { subdomain: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new AppError(409, 'No fue posible reservar un subdominio único automáticamente', 'PLATFORM_SUBDOMAIN_ALLOCATION_EXHAUSTED');
}

async function createTenant(superAdminId, input) {
  const template = TEMPLATE_DEFINITIONS[input.templateCode];
  if (!template || !template.available) {
    throw new AppError(400, 'La plantilla solicitada todavía no está disponible para altas', 'PLATFORM_TEMPLATE_NOT_AVAILABLE');
  }

  const passwordHash = await bcrypt.hash(input.admin.password, 12);

  try {
    return await prisma.$transaction(async (tx) => {
      const admin = await tx.platformSuperAdmin.findFirst({
        where: { id: superAdminId, active: true },
        select: { id: true, name: true, email: true }
      });
      if (!admin) throw new AppError(401, 'Super-administrador de plataforma no válido', 'PLATFORM_AUTH_INVALID');

      const subdomain = await allocateSubdomain(tx, input.nombreEmpresa);
      const tenant = await tx.tenant.create({
        data: {
          nit: input.nit || null,
          nombreEmpresa: input.nombreEmpresa,
          nicho: template.nicho,
          subdomain,
          pais: input.pais,
          moneda: input.moneda,
          activo: true
        }
      });

      const tenantAdmin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          nombre: input.admin.nombre,
          email: input.admin.email,
          password: passwordHash,
          rol: 'ADMIN',
          activo: true
        },
        select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true }
      });

      await seedTenantDefaults(tx, tenant);
      await seedPlatformDefaults(tx, tenant, tenantAdmin);

      if (template.code === 'RESTAURANTE') {
        await tx.restaurantConfig.upsert({
          where: { tenantId: tenant.id },
          create: { tenantId: tenant.id },
          update: {}
        });
      }

      const control = await tx.platformTenantControl.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, planCode: template.code, rolloutChannel: 'ESTABLE' },
        update: { planCode: template.code, rolloutChannel: 'ESTABLE' }
      });

      await tx.platformAudit.create({
        data: {
          superAdminId,
          action: 'TENANT_CREATE',
          entity: 'TENANT',
          entityId: tenant.id,
          tenantId: tenant.id,
          metadata: {
            templateCode: template.code,
            subdomain,
            adminEmail: tenantAdmin.email,
            createdBy: { id: admin.id, email: admin.email }
          }
        }
      });

      return {
        tenant: {
          id: tenant.id,
          nombreEmpresa: tenant.nombreEmpresa,
          nicho: tenant.nicho,
          subdomain: tenant.subdomain,
          pais: tenant.pais,
          moneda: tenant.moneda,
          activo: tenant.activo,
          creadoEn: tenant.creadoEn
        },
        admin: tenantAdmin,
        control,
        template: { code: template.code, label: template.label },
        access: {
          loginUrl: '/app',
          subdomain,
          adminEmail: tenantAdmin.email,
          passwordReturned: false
        }
      };
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'El correo administrador, NIT u otro dato único ya está registrado', 'PLATFORM_TENANT_UNIQUE_CONFLICT');
    }
    throw error;
  }
}

module.exports = { TEMPLATE_DEFINITIONS, templates, slugBase, createTenant };
