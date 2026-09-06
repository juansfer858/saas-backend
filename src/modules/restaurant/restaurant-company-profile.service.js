'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

function clean(value, maxLength = 180) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeProfile(tenant, profile) {
  return {
    nombreEmpresa: clean(tenant?.nombreEmpresa, 160) || 'Restaurante',
    nit: clean(tenant?.nit, 40),
    address: clean(profile?.address, 220),
    city: clean(profile?.city, 120),
    department: clean(profile?.department, 120),
    phone: clean(profile?.phone, 80),
    email: clean(profile?.email, 160)
  };
}

async function getCompanyProfile(tenantId, client = prisma) {
  const [tenant, profile] = await Promise.all([
    client.tenant.findUnique({
      where: { id: tenantId },
      select: { nombreEmpresa: true, nit: true }
    }),
    client.restaurantCompanyProfile.findUnique({ where: { tenantId } })
  ]);

  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  return normalizeProfile(tenant, profile);
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
    return normalizeProfile(tenant, profile);
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
  normalizeProfile,
  getCompanyProfile,
  updateCompanyProfile,
  receiptCompanyLines
};
