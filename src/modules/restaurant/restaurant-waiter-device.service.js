'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');
const { publicBaseUrl } = require('./restaurant-qr.service');

const ORIGIN_TYPE = 'RESTAURANT_WAITER_DEVICE';
const PAIRING_TTL_MS = 10 * 60 * 1000;
const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
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

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function safeDeviceLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return label || 'Tablet / celular Mesero';
}

function latestDeviceMeta(row) {
  return [...timelineArray(row.timeline)].reverse().find((event) => event && event.deviceName) || null;
}

async function audit(tenantId, actorType, actorId, action, entityId, metadata = null, client = prisma) {
  return client.notificationAudit.create({
    data: { tenantId, actorType, actorId: actorId || null, action, entity: 'RestaurantWaiterDevice', entityId: entityId || null, metadata }
  });
}

async function assertMesero(tenantId, userId, client = prisma) {
  const user = await client.user.findFirst({
    where: { id: userId, tenantId, activo: true, rol: 'MESERO' },
    select: { id: true, tenantId: true, nombre: true, email: true, rol: true }
  });
  if (!user) throw new AppError(404, 'El mesero seleccionado no existe o no está activo', 'RESTAURANT_WAITER_DEVICE_USER_INVALID');
  return user;
}

async function createPairing(tenantId, createdByUserId, input) {
  const waiter = await assertMesero(tenantId, input.userId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { nombreEmpresa: true, subdomain: true } });
  if (!tenant) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const originId = crypto.randomUUID();
  const deviceName = safeDeviceLabel(input.deviceName);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const row = await prisma.trackingLink.create({
    data: {
      tenantId,
      tokenHash: hashToken(rawToken),
      tokenCiphertext: encryptJson({ purpose: 'PAIRING', waiterUserId: waiter.id, createdAt: now.toISOString() }),
      tokenHint: rawToken.slice(-6),
      originType: ORIGIN_TYPE,
      originId,
      publicReference: waiter.id,
      currentStatus: 'PAIRING',
      timeline: [{ type: 'PAIRING_CREATED', at: now.toISOString(), waiterUserId: waiter.id, deviceName }],
      expiresAt,
      active: true,
      createdByUserId
    }
  });
  const url = `${publicBaseUrl()}/app/centro-de-control/conectar?t=${encodeURIComponent(rawToken)}`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 420, color: { dark: '#111827', light: '#FFFFFF' } });
  await audit(tenantId, 'USER', createdByUserId, 'WAITER_DEVICE_PAIRING_CREATED', row.id, { waiterUserId: waiter.id, deviceName, expiresAt });
  return { deviceId: row.id, deviceName, waiter, tenant, url, svg, expiresAt };
}

async function inspectPairing(rawToken) {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.trackingLink.findUnique({ where: { tokenHash } });
  const now = new Date();
  if (!row || row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) {
    throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
  }
  const [waiter, tenant] = await Promise.all([
    assertMesero(row.tenantId, row.publicReference),
    prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true, moneda: true } })
  ]);
  const meta = latestDeviceMeta(row);
  return { deviceId: row.id, deviceName: meta?.deviceName || 'Tablet / celular Mesero', waiter, tenant, expiresAt: row.expiresAt };
}

async function claimPairing(rawToken, input = {}) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.trackingLink.findUnique({ where: { tokenHash } });
    if (!row || row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) {
      throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
    }
    const waiter = await assertMesero(row.tenantId, row.publicReference, tx);
    const tenant = await tx.tenant.findUnique({ where: { id: row.tenantId }, select: { id: true, nombreEmpresa: true, subdomain: true, moneda: true } });
    if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
    const previousTimeline = timelineArray(row.timeline);
    const deviceName = safeDeviceLabel(input.deviceName || latestDeviceMeta(row)?.deviceName);
    const activatedUntil = new Date(now.getTime() + DEVICE_TTL_MS);
    const consumeNonce = crypto.randomBytes(32).toString('base64url');
    const updatedCount = await tx.trackingLink.updateMany({
      where: { id: row.id, tokenHash, active: true, currentStatus: 'PAIRING', expiresAt: { gt: now } },
      data: {
        tokenHash: hashToken(consumeNonce),
        tokenCiphertext: encryptJson({ purpose: 'ACTIVE_DEVICE', waiterUserId: waiter.id, pairedAt: now.toISOString() }),
        tokenHint: consumeNonce.slice(-6),
        currentStatus: 'ACTIVE',
        expiresAt: activatedUntil,
        lastNotificationAt: now,
        timeline: [...previousTimeline, { type: 'DEVICE_PAIRED', at: now.toISOString(), waiterUserId: waiter.id, deviceName, userAgent: String(input.userAgent || '').slice(0, 240) }]
      }
    });
    if (updatedCount.count !== 1) throw new AppError(409, 'El vínculo acaba de ser utilizado en otro dispositivo', 'RESTAURANT_WAITER_PAIRING_ALREADY_USED');
    await audit(row.tenantId, 'DEVICE', row.id, 'WAITER_DEVICE_PAIRED', row.id, { waiterUserId: waiter.id, deviceName }, tx);
    return { row: { ...row, id: row.id }, waiter, tenant, deviceName, activatedUntil };
  });

  const token = signAccessToken({
    userId: result.waiter.id,
    tenantId: result.waiter.tenantId,
    rol: result.waiter.rol,
    deviceId: result.row.id,
    authType: 'WAITER_DEVICE',
    expiresIn: '365d'
  });
  return {
    deviceId: result.row.id,
    deviceName: result.deviceName,
    activatedUntil: result.activatedUntil,
    session: { token, subdomain: result.tenant.subdomain, tenant: result.tenant, user: result.waiter }
  };
}

async function listDevices(tenantId) {
  const rows = await prisma.trackingLink.findMany({
    where: { tenantId, originType: ORIGIN_TYPE },
    orderBy: { actualizadoEn: 'desc' },
    take: 100
  });
  const userIds = [...new Set(rows.map((row) => row.publicReference).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, nombre: true, email: true, rol: true, activo: true } }) : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  const now = new Date();
  return rows.map((row) => {
    const meta = latestDeviceMeta(row);
    return {
      id: row.id,
      status: row.currentStatus,
      active: Boolean(row.active && row.currentStatus === 'ACTIVE' && row.expiresAt > now),
      deviceName: meta?.deviceName || 'Tablet / celular Mesero',
      waiter: byId.get(row.publicReference) || null,
      lastSeenAt: row.lastNotificationAt,
      expiresAt: row.expiresAt,
      createdAt: row.creadoEn
    };
  });
}

async function revokeDevice(tenantId, actorUserId, deviceId) {
  const row = await prisma.trackingLink.findFirst({ where: { id: deviceId, tenantId, originType: ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Dispositivo no encontrado', 'RESTAURANT_WAITER_DEVICE_NOT_FOUND');
  if (!row.active || row.currentStatus === 'REVOKED') return { id: row.id, revoked: true };
  const now = new Date();
  const timeline = [...timelineArray(row.timeline), { type: 'DEVICE_REVOKED', at: now.toISOString(), actorUserId }];
  await prisma.$transaction(async (tx) => {
    await tx.trackingLink.update({ where: { id: row.id }, data: { active: false, currentStatus: 'REVOKED', expiresAt: now, timeline } });
    await audit(tenantId, 'USER', actorUserId, 'WAITER_DEVICE_REVOKED', row.id, { waiterUserId: row.publicReference }, tx);
  });
  return { id: row.id, revoked: true };
}

async function assertActiveDevice(deviceId, tenantId, userId) {
  const row = await prisma.trackingLink.findFirst({
    where: { id: deviceId, tenantId, originType: ORIGIN_TYPE, publicReference: userId, active: true, currentStatus: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { id: true, lastNotificationAt: true }
  });
  if (!row) throw new AppError(401, 'Este dispositivo Mesero fue revocado o venció', 'RESTAURANT_WAITER_DEVICE_REVOKED');
  const lastSeen = row.lastNotificationAt ? new Date(row.lastNotificationAt).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen >= LAST_SEEN_WRITE_INTERVAL_MS) {
    await prisma.trackingLink.update({ where: { id: row.id }, data: { lastNotificationAt: new Date() } }).catch(() => {});
  }
  return true;
}

module.exports = {
  ORIGIN_TYPE,
  PAIRING_TTL_MS,
  DEVICE_TTL_MS,
  LAST_SEEN_WRITE_INTERVAL_MS,
  createPairing,
  inspectPairing,
  claimPairing,
  listDevices,
  revokeDevice,
  assertActiveDevice
};
