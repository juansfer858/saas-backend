const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const ISSUER = 'vantixgc-platform';
const AUDIENCE = 'vantixgc-platform-admin';

function secret() {
  const value = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('PLATFORM_JWT_SECRET/JWT_SECRET debe tener al menos 32 caracteres');
  return value;
}

function signPlatformToken(superAdmin) {
  return jwt.sign({ superAdminId: superAdmin.id, scope: 'PLATFORM_ADMIN' }, secret(), { algorithm: 'HS256', expiresIn: '4h', issuer: ISSUER, audience: AUDIENCE });
}

function verifyPlatformToken(token) {
  return jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
}

async function login(email, password) {
  const admin = await prisma.platformSuperAdmin.findUnique({ where: { email } });
  if (!admin || !admin.active || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new AppError(401, 'Credenciales de plataforma inválidas', 'PLATFORM_AUTH_INVALID');
  }
  await prisma.platformSuperAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  return { token: signPlatformToken(admin), user: { id: admin.id, name: admin.name, email: admin.email } };
}

async function bootstrapSuperAdmin({ name, email, password }) {
  if (!email || !password || password.length < 12) throw new Error('PLATFORM_SUPERADMIN_EMAIL y contraseña de mínimo 12 caracteres son requeridos');
  const hash = await bcrypt.hash(password, 12);
  return prisma.platformSuperAdmin.upsert({
    where: { email },
    create: { name, email, passwordHash: hash, active: true },
    update: { name, passwordHash: hash, active: true }
  });
}

async function audit(superAdminId, action, entity, entityId = null, tenantId = null, metadata = null, client = prisma) {
  return client.platformAudit.create({ data: { superAdminId, action, entity, entityId, tenantId, metadata } });
}

async function ensureTenantControl(tenantId, client = prisma) {
  return client.platformTenantControl.upsert({ where: { tenantId }, create: { tenantId, planCode: 'CORE', rolloutChannel: 'ESTABLE' }, update: {} });
}

async function listTenants() {
  const tenants = await prisma.tenant.findMany({ orderBy: { creadoEn: 'desc' } });
  const ids = tenants.map((x) => x.id);
  const controls = ids.length ? await prisma.platformTenantControl.findMany({ where: { tenantId: { in: ids } } }) : [];
  const byControl = new Map(controls.map((x) => [x.tenantId, x]));
  const userCounts = ids.length ? await prisma.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, activo: true }, _count: { _all: true } }) : [];
  const docCounts = ids.length ? await prisma.comprobanteComercial.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }) : [];
  const dianCounts = ids.length ? await prisma.dianDocument.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }) : [];
  const users = new Map(userCounts.map((x) => [x.tenantId, x._count._all]));
  const docs = new Map(docCounts.map((x) => [x.tenantId, x._count._all]));
  const dian = new Map(dianCounts.map((x) => [x.tenantId, x._count._all]));
  return tenants.map((tenant) => ({ ...tenant, control: byControl.get(tenant.id) || null, usage: { activeUsers: users.get(tenant.id) || 0, documents: docs.get(tenant.id) || 0, dianDocuments: dian.get(tenant.id) || 0 } }));
}

async function listTenantUsers(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'PLATFORM_TENANT_NOT_FOUND');
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }]
  });
  return { tenant, users };
}

async function setTenantActive(superAdminId, tenantId, active, reason = null) {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'PLATFORM_TENANT_NOT_FOUND');
    const updated = await tx.tenant.update({ where: { id: tenantId }, data: { activo: active } });
    await tx.platformTenantControl.upsert({ where: { tenantId }, create: { tenantId, suspendReason: active ? null : reason }, update: { suspendReason: active ? null : reason } });
    await audit(superAdminId, active ? 'TENANT_ACTIVATE' : 'TENANT_SUSPEND', 'TENANT', tenantId, tenantId, { reason }, tx);
    return updated;
  });
}

async function setUserActive(superAdminId, tenantId, userId, active) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado', 'PLATFORM_USER_NOT_FOUND');
    const updated = await tx.user.update({ where: { id: userId }, data: { activo: active } });
    await audit(superAdminId, active ? 'USER_ACTIVATE' : 'USER_SUSPEND', 'USER', userId, tenantId, { email: user.email }, tx);
    return { id: updated.id, email: updated.email, activo: updated.activo };
  });
}

async function setTenantControl(superAdminId, tenantId, input) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'PLATFORM_TENANT_NOT_FOUND');
  const data = {
    planCode: input.planCode,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    rolloutChannel: input.rolloutChannel,
    maxUsers: input.maxUsers,
    maxDocumentsMonthly: input.maxDocumentsMonthly,
    maxStorageMb: input.maxStorageMb,
    softLimitPercent: input.softLimitPercent
  };
  Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);
  const control = await prisma.platformTenantControl.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  await audit(superAdminId, 'TENANT_CONTROL_UPDATE', 'PLATFORM_TENANT_CONTROL', control.id, tenantId, data);
  return control;
}

async function metrics() {
  const [total, active, dianTotal, pending, errors] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { activo: true } }),
    prisma.dianDocument.count(),
    prisma.dianDocument.count({ where: { state: { in: ['PENDIENTE_ENVIO', 'CONTINGENCIA'] } } }),
    prisma.dianDocument.count({ where: { state: 'RECHAZADO' } })
  ]);
  const byState = await prisma.dianDocument.groupBy({ by: ['state'], _count: { _all: true } });
  return { tenants: { total, active, suspended: total - active }, dian: { total: dianTotal, pendingOrContingency: pending, rejected: errors, byState } };
}

async function listAudit(limit = 200) {
  return prisma.platformAudit.findMany({ orderBy: { creadoEn: 'desc' }, take: Math.min(Number(limit) || 200, 1000) });
}

module.exports = { verifyPlatformToken, login, bootstrapSuperAdmin, audit, ensureTenantControl, listTenants, listTenantUsers, setTenantActive, setUserActive, setTenantControl, metrics, listAudit };
