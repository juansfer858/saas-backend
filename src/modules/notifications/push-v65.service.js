'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const provider = require('./push-v65.provider');

function secretKey() {
  const seed = process.env.NOTIFICATION_CREDENTIALS_SECRET || process.env.JWT_SECRET;
  if (!seed || String(seed).length < 32) throw new AppError(500, 'NOTIFICATION_CREDENTIALS_SECRET/JWT_SECRET insuficiente', 'PUSH_SECRET_REQUIRED');
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptToken(ciphertext) {
  const [ivRaw, tagRaw, payloadRaw] = String(ciphertext || '').split('.');
  if (!ivRaw || !tagRaw || !payloadRaw) throw new AppError(500, 'Token push cifrado inválido', 'PUSH_TOKEN_CIPHERTEXT_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64url')), decipher.final()]).toString('utf8');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeDevice(row) {
  return {
    id:row.id,
    tenantId:row.tenantId,
    userId:row.userId,
    authType:row.authType,
    authDeviceId:row.authDeviceId,
    role:row.role,
    platform:row.platform,
    deviceLabel:row.deviceLabel,
    permission:row.permission,
    state:row.state,
    lastSeenAt:row.lastSeenAt,
    creadoEn:row.creadoEn,
    actualizadoEn:row.actualizadoEn
  };
}

async function registerDevice(context, input) {
  if (!input.token || String(input.token).length < 20) throw new AppError(400, 'Token push inválido', 'PUSH_TOKEN_INVALID');
  const tokenHash = hashToken(input.token);
  const existing = await prisma.notificationPushDevice.findUnique({ where:{ tokenHash } });
  if (existing && existing.tenantId !== context.tenantId) {
    await prisma.notificationPushDevice.update({
      where:{ id:existing.id },
      data:{ state:'REVOKED', revokedAt:new Date() }
    });
  }
  const row = await prisma.notificationPushDevice.upsert({
    where:{ tokenHash },
    create:{
      tenantId:context.tenantId,
      userId:context.userId,
      authType:context.authType || 'USER',
      authDeviceId:context.deviceId || null,
      role:context.role || 'USER',
      platform:input.platform || 'WEB',
      deviceLabel:input.deviceLabel || null,
      tokenHash,
      tokenCiphertext:encryptToken(input.token),
      permission:input.permission || 'granted',
      state:'ACTIVE',
      userAgent:input.userAgent || null,
      lastSeenAt:new Date(),
      revokedAt:null,
      invalidAt:null
    },
    update:{
      tenantId:context.tenantId,
      userId:context.userId,
      authType:context.authType || 'USER',
      authDeviceId:context.deviceId || null,
      role:context.role || 'USER',
      platform:input.platform || 'WEB',
      deviceLabel:input.deviceLabel || null,
      tokenCiphertext:encryptToken(input.token),
      permission:input.permission || 'granted',
      state:'ACTIVE',
      userAgent:input.userAgent || null,
      lastSeenAt:new Date(),
      revokedAt:null,
      invalidAt:null
    }
  });
  return safeDevice(row);
}

async function listMyDevices(tenantId, userId) {
  const rows = await prisma.notificationPushDevice.findMany({
    where:{ tenantId, userId },
    orderBy:[{ state:'asc' }, { lastSeenAt:'desc' }],
    take:50
  });
  return rows.map(safeDevice);
}

async function revokeDevice(tenantId, userId, deviceId) {
  const row = await prisma.notificationPushDevice.findFirst({ where:{ id:deviceId, tenantId, userId } });
  if (!row) throw new AppError(404, 'Dispositivo push no encontrado', 'PUSH_DEVICE_NOT_FOUND');
  const updated = await prisma.notificationPushDevice.update({
    where:{ id:row.id },
    data:{ state:'REVOKED', revokedAt:new Date() }
  });
  return safeDevice(updated);
}

async function sendDelivery(device, input) {
  const delivery = await prisma.notificationPushDelivery.create({
    data:{
      tenantId:device.tenantId,
      pushDeviceId:device.id,
      eventCode:input.eventCode || 'PUSH_TEST',
      title:input.title,
      body:input.body,
      deepLink:input.deepLink || '/app/centro-de-control',
      state:'SENDING',
      retryCount:1,
      nextRetryAt:null
    }
  });
  try {
    const sent = await provider.sendToToken(decryptToken(device.tokenCiphertext), {
      tenantId:device.tenantId,
      deliveryId:delivery.id,
      eventCode:delivery.eventCode,
      title:delivery.title,
      body:delivery.body,
      deepLink:delivery.deepLink
    });
    await prisma.notificationPushDelivery.update({
      where:{ id:delivery.id },
      data:{ state:'SENT', providerMessageId:sent.providerMessageId, sentAt:new Date(), lastError:null }
    });
    await prisma.notificationPushDevice.update({ where:{ id:device.id }, data:{ lastSeenAt:new Date() } });
    return { ok:true, deliveryId:delivery.id, providerMessageId:sent.providerMessageId };
  } catch (error) {
    await prisma.notificationPushDelivery.update({
      where:{ id:delivery.id },
      data:{ state:'FAILED', failedAt:new Date(), lastError:String(error.message || error), nextRetryAt:null }
    });
    if (error.invalidToken) {
      await prisma.notificationPushDevice.update({ where:{ id:device.id }, data:{ state:'INVALID', invalidAt:new Date() } });
    }
    throw new AppError(error.httpStatus || 502, error.message || 'No fue posible enviar el push', error.invalidToken ? 'PUSH_TOKEN_INVALIDATED' : 'PUSH_SEND_FAILED');
  }
}

async function sendSelfTest(tenantId, userId, input = {}) {
  const where = { tenantId, userId, state:'ACTIVE' };
  if (input.deviceId) where.id = input.deviceId;
  const device = await prisma.notificationPushDevice.findFirst({ where, orderBy:{ lastSeenAt:'desc' } });
  if (!device) throw new AppError(404, 'No hay un dispositivo push activo para este usuario', 'PUSH_DEVICE_REQUIRED');
  return sendDelivery(device, {
    eventCode:'PUSH_TEST',
    title:'VantixGC · Notificación de prueba',
    body:'Las notificaciones push están funcionando en este dispositivo.',
    deepLink:'/app/centro-de-control'
  });
}

// Best-effort operational fanout. It is deliberately separated from the business
// transaction: a Firebase outage must never fail an order, account request or KDS change.
async function sendOperationalEvent(tenantId, input = {}) {
  const roles=[...new Set((input.roles || []).map((value)=>String(value || '').toUpperCase()).filter(Boolean))];
  const userIds=[...new Set((input.userIds || []).map((value)=>String(value || '').trim()).filter(Boolean))];
  const audience=[];
  if (roles.length) audience.push({ role:{ in:roles } });
  if (userIds.length) audience.push({ userId:{ in:userIds } });
  if (!audience.length) return { matched:0, sent:0, failed:0 };
  if (!provider.publicWebConfig().enabled) return { matched:0, sent:0, failed:0, skipped:'FCM_NOT_CONFIGURED' };
  const devices=await prisma.notificationPushDevice.findMany({
    where:{ tenantId, state:'ACTIVE', permission:'granted', OR:audience },
    orderBy:{ lastSeenAt:'desc' },
    take:250
  });
  let sent=0;let failed=0;
  for (const device of devices) {
    try {
      await sendDelivery(device, {
        eventCode:input.eventCode || 'RESTAURANT_ACTIVITY',
        title:input.title || 'VantixGC Restaurantes',
        body:input.body || 'Nueva actividad en el restaurante.',
        deepLink:input.deepLink || '/app/centro-de-control'
      });
      sent+=1;
    } catch { failed+=1; }
  }
  return { matched:devices.length, sent, failed };
}

function publicConfig() {
  return provider.publicWebConfig();
}

module.exports = {
  publicConfig,
  registerDevice,
  listMyDevices,
  revokeDevice,
  sendSelfTest,
  sendDelivery,
  sendOperationalEvent,
  hashToken
};
