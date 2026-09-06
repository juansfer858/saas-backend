'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

function clean(value, maxLength = 180) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function onboardingProfile(row) {
  const value = row?.profile ?? row;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeProfile(tenant, profile, onboarding = null, admin = null) {
  const signup = onboardingProfile(onboarding);
  return {
    nombreEmpresa: clean(tenant?.nombreEmpresa, 160) || clean(signup.restaurantName, 160) || 'Restaurante',
    nit: clean(tenant?.nit, 40),
    address: clean(profile?.address, 220) || clean(signup.address, 220),
    city: clean(profile?.city, 120) || clean(signup.city, 120),
    department: clean(profile?.department, 120) || clean(signup.department, 120),
    phone: clean(profile?.phone, 80) || clean(signup.phone, 80),
    email: clean(profile?.email, 160) || clean(signup.email, 160) || clean(admin?.email, 160)
  };
}

async function getCompanyProfile(tenantId, client = prisma) {
  const onboardingPromise = client.tenantOnboarding?.findUnique
    ? client.tenantOnboarding.findUnique({ where: { tenantId }, select: { profile: true } })
    : Promise.resolve(null);
  const adminPromise = client.user?.findFirst
    ? client.user.findFirst({
      where: { tenantId, rol: { in: ['ADMIN', 'SUPER_ADMIN'] }, activo: true },
      orderBy: { creadoEn: 'asc' },
      select: { email: true }
    })
    : Promise.resolve(null);
  const [tenant, profile, onboarding, admin] = await Promise.all([
    client.tenant.findUnique({
      where: { id: tenantId },
      select: { nombreEmpresa: true, nit: true }
    }),
    client.restaurantCompanyProfile.findUnique({ where: { tenantId } }),
    onboardingPromise,
    adminPromise
  ]);

  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  return normalizeProfile(tenant, profile, onboarding, admin);
}

async function updateCompanyProfile(tenantId, input, client = prisma) {
  const nombreEmpresa = clean(input?.nombreEmpresa, 160);
  if (!nombreEmpresa) throw new AppError(400, 'El nombre de la empresa es obligatorio', 'COMPANY_NAME_REQUIRED');

  const tenantData = {
    nombreEmpresa,
    nit: clean(input?.nit, 40)
  };
  const profileData = {
    address: clean(input?.address, 220),
    city: clean(input?.city, 120),
    department: clean(input?.department, 120),
    phone: clean(input?.phone, 80),
    email: clean(input?.email, 160)
  };

  return client.$transaction(async (tx) => {
    const currentOnboarding = tx.tenantOnboarding?.findUnique
      ? await tx.tenantOnboarding.findUnique({ where: { tenantId }, select: { profile: true } })
      : null;
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: tenantData,
      select: { nombreEmpresa: true, nit: true }
    });
    const profile = await tx.restaurantCompanyProfile.upsert({
      where: { tenantId },
      create: { tenantId, ...profileData },
      update: profileData
    });

    let syncedOnboarding = currentOnboarding;
    if (currentOnboarding && tx.tenantOnboarding?.update) {
      const mergedProfile = {
        ...onboardingProfile(currentOnboarding),
        restaurantName: nombreEmpresa,
        address: profileData.address,
        city: profileData.city,
        department: profileData.department,
        phone: profileData.phone,
        email: profileData.email
      };
      syncedOnboarding = await tx.tenantOnboarding.update({
        where: { tenantId },
        data: { profile: mergedProfile },
        select: { profile: true }
      });
    }

    return normalizeProfile(tenant, profile, syncedOnboarding, { email: profileData.email });
  });
}

function receiptCompanyLines(profile) {
  const lines = [];
  const nit = clean(profile?.nit, 40);
  const address = clean(profile?.address, 220);
  const city = clean(profile?.city, 120);
  const department = clean(profile?.department, 120);
  const phone = clean(profile?.phone, 80);
  const email = clean(profile?.email, 160);

  if (nit) lines.push(`NIT: ${nit}`);
  if (address) lines.push(`Dirección: ${address}`);
  if (city || department) lines.push([city, department].filter(Boolean).join(' · '));
  if (phone) lines.push(`Tel: ${phone}`);
  if (email) lines.push(email);
  return lines;
}

module.exports = {
  clean,
  onboardingProfile,
  normalizeProfile,
  getCompanyProfile,
  updateCompanyProfile,
  receiptCompanyLines
};
