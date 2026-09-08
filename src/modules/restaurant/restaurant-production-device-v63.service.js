'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');
const { publicBaseUrl } = require('./restaurant-qr.service');

const ORIGIN_TYPE = 'RESTAURANT_PRODUCTION_DEVICE_V63';
const PRODUCTION_ROLES = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const PAIRING_TTL_MS = 10 * 60 * 1000;
const DEVICE_PERSISTENT_UNTIL = new Date('9999-12-31T23:59:59.000Z');
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function secretKey() {
  const seed = process.env.RESTAURANT_DEVICE_SECRET || process.env.JWT_SECRET;
  if (!seed || String(seed).length < 32) throw new AppError(500, 'RESTAURANT_DEVICE_SECRET/JWT_SECRET insuficiente', 'RESTAURANT_DEVICE_SECRET_REQUIRED');
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}
function roleLabel(role) { return role === 'COCINA' ? 'Cocina' : role === 'BARRA' ? 'Barra' : role === 'POSTRES' ? 'Postres' : 'Producción'; }
function safeDeviceLabel(value, role) {
  const label = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return label || `Tablet ${roleLabel(role)}`;
}
function latestDeviceMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event && event.deviceName) || null;
}
async function audit(tenantId, actorType, actorId, action, entityId, metadata = null, client = prisma) {
  return client.notificationAudit.create({
    data: { tenantId, actorType, actorId: actorId || null, action, entity: 'RestaurantProductionDevice', entityId: entityId || null, metadata }
  });
}

async function assertProductionUser(tenantId, userId, client = prisma) {
  const user = await client.user.findFirst({
    where: { id: userId, tenantId, activo: true, rol: { in: PRODUCTION_ROLES } },
    select: { id: true, tenantId: true, nombre: true, email: true, rol: true }
  });
  if (!user) throw new AppError(404, 'El empleado de producción no existe o no está activo', 'RESTAURANT_PRODUCTION_DEVICE_USER_INVALID');
  return user;
}

function permanentSessionToken(user, deviceId) {
  return signAccessToken({ userId: user.id, tenantId: user.tenantId, rol: user.rol, deviceId, authType: 'PRODUCTION_DEVICE', permanent: true });
}

async function createPairing(tenantId, createdByUserId, input) {
  const user = await assertProductionUser(tenantId, input.userId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true, moneda: true } });
  if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const originId = crypto.randomUUID();
  const deviceName = safeDeviceLabel(input.deviceName, user.rol);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const row = await prisma.trackingLink.create({
    data: {
      tenantId,
      tokenHash: hashToken(rawToken),
      tokenCiphertext: encryptJson({ purpose: 'PRODUCTION_PAIRING', userId: user.id, productionRole: user.rol, createdAt: now.toISOString() }),
      tokenHint: rawToken.slice(-6),
      originType: ORIGIN_TYPE,
      originId,
      publicReference: user.id,
      currentStatus: 'PAIRING',
      timeline: [{ type: 'PAIRING_CREATED', at: now.toISOString(), userId: user.id, productionRole: user.rol, deviceName }],
      expiresAt,
      active: true,
      createdByUserId
    }
  });
  const url = `${publicBaseUrl()}/app/produccion/conectar?t=${encodeURIComponent(rawToken)}`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 420, color: { dark: '#111827', light: '#FFFFFF' } });
  await audit(tenantId, 'USER', createdByUserId, 'PRODUCTION_DEVICE_PAIRING_CREATED', row.id, { userId: user.id, productionRole: user.rol, deviceName, expiresAt });
  return { deviceId: row.id, deviceName, station: user.rol, user, tenant, url, svg, expiresAt };
}

async function inspectPairing(rawToken) {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.trackingLink.findUnique({ where: { tokenHash } });
  const now = new Date();
  if (!row || row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) {
    throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_PRODUCTION_PAIRING_EXPIRED');
  }
  const [user, tenant] = await Promise.all([
    assertProductionUser(row.tenantId, row.publicReference),
    prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true, moneda: true } })
  ]);
  const meta = latestDeviceMeta(row);
  return {
    deviceId: row.id,
    deviceName: meta?.deviceName || safeDeviceLabel(null, user.rol),
    station: user.rol,
    user,
    tenant,
    expiresAt: row.expiresAt
  };
}

async function claimPairing(rawToken, input = {}) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.trackingLink.findUnique({ where: { tokenHash } });
    if (!row || row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) {
      throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_PRODUCTION_PAIRING_EXPIRED');
    }
    const user = await assertProductionUser(row.tenantId, row.publicReference, tx);
    const tenant = await tx.tenant.findUnique({ where: { id: row.tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true, moneda: true } });
    if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
    const previousTimeline = timelineArray(row.timeline);
    const deviceName = safeDeviceLabel(input.deviceName || latestDeviceMeta(row)?.deviceName, user.rol);
    const consumeNonce = crypto.randomBytes(32).toString('base64url');
    const changed = await tx.trackingLink.updateMany({
      where: { id: row.id, tokenHash, active: true, currentStatus: 'PAIRING', expiresAt: { gt: now } },
      data: {
        tokenHash: hashToken(consumeNonce),
        tokenCiphertext: encryptJson({ purpose: 'ACTIVE_PRODUCTION_DEVICE', userId: user.id, productionRole: user.rol, pairedAt: now.toISOString(), persistent: true }),
        tokenHint: consumeNonce.slice(-6),
        currentStatus: 'ACTIVE',
        expiresAt: DEVICE_PERSISTENT_UNTIL,
        lastNotificationAt: now,
        timeline: [...previousTimeline, { type: 'DEVICE_PAIRED', at: now.toISOString(), userId: user.id, productionRole: user.rol, deviceName, persistent: true, userAgent: String(input.userAgent || '').slice(0, 240) }]
      }
    });
    if (changed.count !== 1) throw new AppError(409, 'El vínculo acaba de utilizarse en otro dispositivo', 'RESTAURANT_PRODUCTION_PAIRING_ALREADY_USED');
    await audit(row.tenantId, 'DEVICE', row.id, 'PRODUCTION_DEVICE_PAIRED', row.id, { userId: user.id, productionRole: user.rol, deviceName, persistent: true }, tx);
    return { row, user, tenant, deviceName };
  });
  const token = permanentSessionToken(result.user, result.row.id);
  return {
    deviceId: result.row.id,
    deviceName: result.deviceName,
    station: result.user.rol,
    persistent: true,
    session: {
      token,
      subdomain: result.tenant.subdomain,
      tenant: result.tenant,
      user: result.user,
      deviceId: result.row.id,
      authType: 'PRODUCTION_DEVICE',
      persistent: true
    }
  };
}

async function listDevices(tenantId) {
  const rows = await prisma.trackingLink.findMany({ where: { tenantId, originType: ORIGIN_TYPE }, orderBy: { actualizadoEn: 'desc' }, take: 100 });
  const userIds = [...new Set(rows.map((row) => row.publicReference).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({
    where: { tenantId, id: { in: userIds } },
    select: { id: true, nombre: true, email: true, rol: true, activo: true }
  }) : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => {
    const meta = latestDeviceMeta(row);
    const user = byId.get(row.publicReference) || null;
    const pairedRole = meta?.productionRole || null;
    const persistent = row.currentStatus === 'ACTIVE';
    return {
      id: row.id,
      status: row.currentStatus,
      active: Boolean(row.active && persistent && user?.activo && PRODUCTION_ROLES.includes(user?.rol) && (!pairedRole || pairedRole === user.rol)),
      persistent,
      deviceName: meta?.deviceName || safeDeviceLabel(null, pairedRole || user?.rol),
      station: pairedRole || user?.rol || null,
      user,
      lastSeenAt: row.lastNotificationAt,
      expiresAt: persistent ? null : row.expiresAt,
      createdAt: row.creadoEn
    };
  });
}

async function revokeDevice(tenantId, actorUserId, deviceId) {
  const row = await prisma.trackingLink.findFirst({ where: { id: deviceId, tenantId, originType: ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Dispositivo de producción no encontrado', 'RESTAURANT_PRODUCTION_DEVICE_NOT_FOUND');
  if (!row.active || row.currentStatus === 'REVOKED') return { id: row.id, revoked: true };
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type: 'DEVICE_REVOKED', at: now.toISOString(), actorUserId }];
  await prisma.$transaction(async (tx) => {
    await tx.trackingLink.update({ where: { id: row.id }, data: { active: false, currentStatus: 'REVOKED', expiresAt: now, timeline } });
    await audit(tenantId, 'USER', actorUserId, 'PRODUCTION_DEVICE_REVOKED', row.id, { userId: row.publicReference }, tx);
  });
  return { id: row.id, revoked: true };
}

async function assertActiveDevice(deviceId, tenantId, userId, currentRole) {
  const row = await prisma.trackingLink.findFirst({
    where: { id: deviceId, tenantId, originType: ORIGIN_TYPE, publicReference: userId, active: true, currentStatus: 'ACTIVE' },
    select: { id: true, timeline: true, lastNotificationAt: true }
  });
  if (!row) throw new AppError(401, 'Esta tablet de producción fue desautorizada', 'RESTAURANT_PRODUCTION_DEVICE_REVOKED');
  if (!PRODUCTION_ROLES.includes(currentRole)) throw new AppError(401, 'El usuario ya no tiene un rol de producción válido', 'RESTAURANT_PRODUCTION_DEVICE_ROLE_INVALID');
  const meta = latestDeviceMeta(row);
  if (meta?.productionRole && meta.productionRole !== currentRole) {
    throw new AppError(401, 'El rol de esta tablet cambió. Vincúlala de nuevo desde Administración.', 'RESTAURANT_PRODUCTION_DEVICE_ROLE_CHANGED');
  }
  const lastSeen = row.lastNotificationAt ? new Date(row.lastNotificationAt).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen >= LAST_SEEN_WRITE_INTERVAL_MS) {
    await prisma.trackingLink.update({ where: { id: row.id }, data: { lastNotificationAt: new Date() } }).catch(() => {});
  }
  return true;
}

module.exports = {
  ORIGIN_TYPE,
  PRODUCTION_ROLES,
  PAIRING_TTL_MS,
  DEVICE_PERSISTENT_UNTIL,
  LAST_SEEN_WRITE_INTERVAL_MS,
  createPairing,
  inspectPairing,
  claimPairing,
  listDevices,
  revokeDevice,
  assertActiveDevice
};
