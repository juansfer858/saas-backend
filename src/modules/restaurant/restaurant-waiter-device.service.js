'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');
const { publicBaseUrl } = require('./restaurant-qr.service');

const ORIGIN_TYPE = 'RESTAURANT_WAITER_DEVICE';
const ENROLLMENT_ORIGIN_TYPE = 'RESTAURANT_WAITER_ENROLLMENT_V2';
const PAIRING_TTL_MS = 10 * 60 * 1000; // compatibilidad con vínculos antiguos de un solo uso
const DEVICE_PERSISTENT_UNTIL = new Date('9999-12-31T23:59:59.000Z');
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_DEVICES_PER_WAITER = 25;

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
function decryptJson(value) {
  const [ivRaw, tagRaw, encryptedRaw] = String(value || '').split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('INVALID_ENCRYPTED_JSON');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const clear = Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(clear);
}
function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  return [];
}
function safeDeviceLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return label || 'Tablet / celular Mesero';
}
function latestDeviceMeta(row) { return [...timelineArray(row?.timeline)].reverse().find((event) => event && event.deviceName) || null; }
async function audit(tenantId, actorType, actorId, action, entityId, metadata = null, client = prisma) {
  return client.notificationAudit.create({ data: { tenantId, actorType, actorId: actorId || null, action, entity: 'RestaurantWaiterDevice', entityId: entityId || null, metadata } });
}
async function assertMesero(tenantId, userId, client = prisma) {
  const user = await client.user.findFirst({ where: { id: userId, tenantId, activo: true, rol: 'MESERO' }, select: { id: true, tenantId: true, nombre: true, email: true, rol: true } });
  if (!user) throw new AppError(404, 'El mesero seleccionado no existe o no está activo', 'RESTAURANT_WAITER_DEVICE_USER_INVALID');
  return user;
}
function permanentSessionToken(waiter, deviceId) {
  return signAccessToken({ userId: waiter.id, tenantId: waiter.tenantId, rol: waiter.rol, deviceId, authType: 'WAITER_DEVICE', permanent: true });
}
function reusableEnrollmentData(row) {
  if (!row || row.originType !== ENROLLMENT_ORIGIN_TYPE || !row.active || row.currentStatus !== 'ACTIVE') return null;
  try {
    const data = decryptJson(row.tokenCiphertext);
    if (data?.purpose !== 'REUSABLE_WAITER_ENROLLMENT' || !data.rawToken || hashToken(data.rawToken) !== row.tokenHash) return null;
    return data;
  } catch { return null; }
}

async function createReservedPrimaryDevice(tx, tenantId, waiter, deviceName, createdByUserId) {
  const nonce = crypto.randomBytes(32).toString('base64url');
  return tx.trackingLink.create({
    data:{
      tenantId,
      tokenHash:hashToken(nonce),
      tokenCiphertext:encryptJson({ purpose:'PAIRING_RESERVED', waiterUserId:waiter.id, createdAt:new Date().toISOString() }),
      tokenHint:nonce.slice(-6),
      originType:ORIGIN_TYPE,
      originId:crypto.randomUUID(),
      publicReference:waiter.id,
      currentStatus:'PAIRING_RESERVED',
      timeline:[{ type:'DEVICE_SLOT_RESERVED', at:new Date().toISOString(), waiterUserId:waiter.id, deviceName }],
      expiresAt:DEVICE_PERSISTENT_UNTIL,
      active:false,
      createdByUserId
    }
  });
}

async function createPairing(tenantId, createdByUserId, input) {
  const waiter = await assertMesero(tenantId, input.userId);
  const tenant = await prisma.tenant.findUnique({ where:{ id:tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } });
  if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
  const deviceName = safeDeviceLabel(input.deviceName);

  const result = await prisma.$transaction(async tx => {
    let enrollment = await tx.trackingLink.findUnique({
      where:{ tenantId_originType_originId:{ tenantId, originType:ENROLLMENT_ORIGIN_TYPE, originId:waiter.id } }
    });
    let data = reusableEnrollmentData(enrollment);
    if (data) {
      let primary = data.primaryDeviceId ? await tx.trackingLink.findFirst({ where:{ id:data.primaryDeviceId, tenantId, originType:ORIGIN_TYPE } }) : null;
      if (!primary) {
        primary = await createReservedPrimaryDevice(tx, tenantId, waiter, deviceName, createdByUserId);
        data = { ...data, primaryDeviceId:primary.id };
        enrollment = await tx.trackingLink.update({ where:{ id:enrollment.id }, data:{ tokenCiphertext:encryptJson(data) } });
      }
      return { enrollment, data, primaryDeviceId:data.primaryDeviceId, reused:true };
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const primary = await createReservedPrimaryDevice(tx, tenantId, waiter, deviceName, createdByUserId);
    data = {
      purpose:'REUSABLE_WAITER_ENROLLMENT',
      rawToken,
      waiterUserId:waiter.id,
      primaryDeviceId:primary.id,
      createdAt:new Date().toISOString(),
      reusable:true
    };
    const enrollmentData = {
      tokenHash:hashToken(rawToken),
      tokenCiphertext:encryptJson(data),
      tokenHint:rawToken.slice(-6),
      publicReference:waiter.id,
      currentStatus:'ACTIVE',
      timeline:[{ type:'REUSABLE_ENROLLMENT_CREATED', at:new Date().toISOString(), waiterUserId:waiter.id, deviceName, primaryDeviceId:primary.id }],
      expiresAt:DEVICE_PERSISTENT_UNTIL,
      active:true,
      createdByUserId
    };
    enrollment = await tx.trackingLink.upsert({
      where:{ tenantId_originType_originId:{ tenantId, originType:ENROLLMENT_ORIGIN_TYPE, originId:waiter.id } },
      create:{ tenantId, originType:ENROLLMENT_ORIGIN_TYPE, originId:waiter.id, ...enrollmentData },
      update:enrollmentData
    });
    return { enrollment, data, primaryDeviceId:primary.id, reused:false };
  });

  const url = `${publicBaseUrl()}/app/centro-de-control/conectar?t=${encodeURIComponent(result.data.rawToken)}`;
  const svg = await QRCode.toString(url, { type:'svg', errorCorrectionLevel:'M', margin:2, width:420, color:{ dark:'#111827', light:'#FFFFFF' } });
  await audit(tenantId, 'USER', createdByUserId, result.reused ? 'WAITER_REUSABLE_PAIRING_REUSED' : 'WAITER_REUSABLE_PAIRING_CREATED', result.enrollment.id, { waiterUserId:waiter.id, deviceName, reusable:true, primaryDeviceId:result.primaryDeviceId }).catch(() => {});
  return { deviceId:result.primaryDeviceId, enrollmentId:result.enrollment.id, deviceName, waiter, tenant, url, svg, expiresAt:null, reusable:true, multipleDevices:true };
}

async function inspectPairing(rawToken) {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.trackingLink.findUnique({ where:{ tokenHash } });
  const now = new Date();
  if (!row) throw new AppError(410, 'Este vínculo ya no está disponible', 'RESTAURANT_WAITER_PAIRING_EXPIRED');

  if (row.originType === ENROLLMENT_ORIGIN_TYPE) {
    const data = reusableEnrollmentData(row);
    if (!data || row.expiresAt <= now) throw new AppError(410, 'Este vínculo ya no está disponible', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
    const [waiter, tenant] = await Promise.all([
      assertMesero(row.tenantId, row.publicReference),
      prisma.tenant.findUnique({ where:{ id:row.tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } })
    ]);
    return { enrollmentId:row.id, deviceId:data.primaryDeviceId || null, deviceName:'Tablet / celular Mesero', waiter, tenant, expiresAt:null, reusable:true, multipleDevices:true };
  }

  // Compatibilidad con QR antiguos generados antes de V11.
  if (row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) {
    throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
  }
  const [waiter, tenant] = await Promise.all([
    assertMesero(row.tenantId, row.publicReference),
    prisma.tenant.findUnique({ where:{ id:row.tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } })
  ]);
  const meta = latestDeviceMeta(row);
  return { deviceId:row.id, deviceName:meta?.deviceName || 'Tablet / celular Mesero', waiter, tenant, expiresAt:row.expiresAt, reusable:false, multipleDevices:false };
}

async function claimReusableEnrollment(tx, enrollment, input, now) {
  const data = reusableEnrollmentData(enrollment);
  if (!data || enrollment.expiresAt <= now) throw new AppError(410, 'Este vínculo ya no está disponible', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
  const waiter = await assertMesero(enrollment.tenantId, enrollment.publicReference, tx);
  const tenant = await tx.tenant.findUnique({ where:{ id:enrollment.tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } });
  if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
  const activeCount = await tx.trackingLink.count({ where:{ tenantId:enrollment.tenantId, originType:ORIGIN_TYPE, publicReference:waiter.id, active:true, currentStatus:'ACTIVE' } });
  if (activeCount >= MAX_ACTIVE_DEVICES_PER_WAITER) throw new AppError(429, `Máximo ${MAX_ACTIVE_DEVICES_PER_WAITER} dispositivos activos por mesero`, 'RESTAURANT_WAITER_DEVICE_LIMIT');
  const deviceName = safeDeviceLabel(input.deviceName);
  const event = { type:'DEVICE_PAIRED', at:now.toISOString(), waiterUserId:waiter.id, deviceName, persistent:true, reusableEnrollmentId:enrollment.id, userAgent:String(input.userAgent || '').slice(0,240) };

  let device = data.primaryDeviceId ? await tx.trackingLink.findFirst({ where:{ id:data.primaryDeviceId, tenantId:enrollment.tenantId, originType:ORIGIN_TYPE, currentStatus:'PAIRING_RESERVED' } }) : null;
  const nonce = crypto.randomBytes(32).toString('base64url');
  if (device) {
    device = await tx.trackingLink.update({
      where:{ id:device.id },
      data:{ tokenHash:hashToken(nonce), tokenCiphertext:encryptJson({ purpose:'ACTIVE_DEVICE', waiterUserId:waiter.id, pairedAt:now.toISOString(), persistent:true, enrollmentId:enrollment.id }), tokenHint:nonce.slice(-6), currentStatus:'ACTIVE', expiresAt:DEVICE_PERSISTENT_UNTIL, active:true, lastNotificationAt:now, timeline:[...timelineArray(device.timeline), event] }
    });
  } else {
    device = await tx.trackingLink.create({
      data:{ tenantId:enrollment.tenantId, tokenHash:hashToken(nonce), tokenCiphertext:encryptJson({ purpose:'ACTIVE_DEVICE', waiterUserId:waiter.id, pairedAt:now.toISOString(), persistent:true, enrollmentId:enrollment.id }), tokenHint:nonce.slice(-6), originType:ORIGIN_TYPE, originId:crypto.randomUUID(), publicReference:waiter.id, currentStatus:'ACTIVE', timeline:[event], expiresAt:DEVICE_PERSISTENT_UNTIL, active:true, lastNotificationAt:now, createdByUserId:enrollment.createdByUserId }
    });
  }
  await audit(enrollment.tenantId, 'DEVICE', device.id, 'WAITER_DEVICE_PAIRED_REUSABLE', device.id, { waiterUserId:waiter.id, deviceName, reusableEnrollmentId:enrollment.id, persistent:true }, tx);
  return { device, waiter, tenant, deviceName, reusable:true };
}

async function claimLegacyPairing(tx, row, tokenHash, input, now) {
  if (row.originType !== ORIGIN_TYPE || !row.active || row.currentStatus !== 'PAIRING' || row.expiresAt <= now) throw new AppError(410, 'Este vínculo ya venció o fue utilizado', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
  const waiter = await assertMesero(row.tenantId, row.publicReference, tx);
  const tenant = await tx.tenant.findUnique({ where:{ id:row.tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } });
  if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
  const previousTimeline = timelineArray(row.timeline);
  const deviceName = safeDeviceLabel(input.deviceName || latestDeviceMeta(row)?.deviceName);
  const consumeNonce = crypto.randomBytes(32).toString('base64url');
  const updatedCount = await tx.trackingLink.updateMany({ where:{ id:row.id, tokenHash, active:true, currentStatus:'PAIRING', expiresAt:{ gt:now } }, data:{ tokenHash:hashToken(consumeNonce), tokenCiphertext:encryptJson({ purpose:'ACTIVE_DEVICE', waiterUserId:waiter.id, pairedAt:now.toISOString(), persistent:true }), tokenHint:consumeNonce.slice(-6), currentStatus:'ACTIVE', expiresAt:DEVICE_PERSISTENT_UNTIL, lastNotificationAt:now, timeline:[...previousTimeline,{ type:'DEVICE_PAIRED', at:now.toISOString(), waiterUserId:waiter.id, deviceName, persistent:true, userAgent:String(input.userAgent || '').slice(0,240) }] } });
  if (updatedCount.count !== 1) throw new AppError(409, 'El vínculo acaba de ser utilizado en otro dispositivo', 'RESTAURANT_WAITER_PAIRING_ALREADY_USED');
  await audit(row.tenantId, 'DEVICE', row.id, 'WAITER_DEVICE_PAIRED', row.id, { waiterUserId:waiter.id, deviceName, persistent:true }, tx);
  return { device:{ ...row, id:row.id }, waiter, tenant, deviceName, reusable:false };
}

async function claimPairing(rawToken, input = {}) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const result = await prisma.$transaction(async tx => {
    const row = await tx.trackingLink.findUnique({ where:{ tokenHash } });
    if (!row) throw new AppError(410, 'Este vínculo ya no está disponible', 'RESTAURANT_WAITER_PAIRING_EXPIRED');
    if (row.originType === ENROLLMENT_ORIGIN_TYPE) return claimReusableEnrollment(tx, row, input, now);
    return claimLegacyPairing(tx, row, tokenHash, input, now);
  });
  const token = permanentSessionToken(result.waiter, result.device.id);
  return {
    deviceId:result.device.id,
    deviceName:result.deviceName,
    reusable:result.reusable,
    persistent:true,
    activatedUntil:null,
    session:{ token, subdomain:result.tenant.subdomain, tenant:result.tenant, user:result.waiter, deviceId:result.device.id, authType:'WAITER_DEVICE', persistent:true }
  };
}

async function renewDeviceSession(deviceId, tenantId, userId) {
  const row = await prisma.trackingLink.findFirst({ where:{ id:deviceId, tenantId, originType:ORIGIN_TYPE, publicReference:userId, active:true, currentStatus:'ACTIVE' } });
  if (!row) throw new AppError(401, 'Este dispositivo Mesero fue desautorizado', 'RESTAURANT_WAITER_DEVICE_REVOKED');
  const [waiter, tenant] = await Promise.all([assertMesero(tenantId, userId), prisma.tenant.findUnique({ where:{ id:tenantId }, select:{ id:true, nombreEmpresa:true, subdomain:true, moneda:true } })]);
  if (!tenant?.subdomain) throw new AppError(404, 'Restaurante no encontrado', 'TENANT_NOT_FOUND');
  await prisma.trackingLink.update({ where:{ id:row.id }, data:{ expiresAt:DEVICE_PERSISTENT_UNTIL, lastNotificationAt:new Date() } }).catch(() => {});
  const token = permanentSessionToken(waiter, row.id);
  return { deviceId:row.id, persistent:true, session:{ token, subdomain:tenant.subdomain, tenant, user:waiter, deviceId:row.id, authType:'WAITER_DEVICE', persistent:true } };
}

async function listDevices(tenantId) {
  const rows = await prisma.trackingLink.findMany({ where:{ tenantId, originType:ORIGIN_TYPE, currentStatus:{ not:'PAIRING_RESERVED' } }, orderBy:{ actualizadoEn:'desc' }, take:100 });
  const userIds = [...new Set(rows.map(row=>row.publicReference).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where:{ tenantId, id:{ in:userIds } }, select:{ id:true, nombre:true, email:true, rol:true, activo:true } }) : [];
  const byId = new Map(users.map(user=>[user.id,user]));
  return rows.map(row=>{const meta=latestDeviceMeta(row);const persistent=row.currentStatus==='ACTIVE';return { id:row.id, status:row.currentStatus, active:Boolean(row.active&&row.currentStatus==='ACTIVE'), persistent, deviceName:meta?.deviceName||'Tablet / celular Mesero', waiter:byId.get(row.publicReference)||null, lastSeenAt:row.lastNotificationAt, expiresAt:persistent?null:row.expiresAt, createdAt:row.creadoEn };});
}

async function revokeDevice(tenantId, actorUserId, deviceId) {
  const row = await prisma.trackingLink.findFirst({ where:{ id:deviceId, tenantId, originType:ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Dispositivo no encontrado', 'RESTAURANT_WAITER_DEVICE_NOT_FOUND');
  if (!row.active || row.currentStatus==='REVOKED') return { id:row.id, revoked:true };
  const now = new Date();
  const timeline = [...timelineArray(row.timeline),{ type:'DEVICE_REVOKED', at:now.toISOString(), actorUserId }];
  await prisma.$transaction(async tx=>{await tx.trackingLink.update({ where:{ id:row.id }, data:{ active:false, currentStatus:'REVOKED', expiresAt:now, timeline } });await audit(tenantId,'USER',actorUserId,'WAITER_DEVICE_REVOKED',row.id,{ waiterUserId:row.publicReference },tx);});
  return { id:row.id, revoked:true };
}

async function assertActiveDevice(deviceId, tenantId, userId) {
  const row = await prisma.trackingLink.findFirst({ where:{ id:deviceId, tenantId, originType:ORIGIN_TYPE, publicReference:userId, active:true, currentStatus:'ACTIVE' }, select:{ id:true, lastNotificationAt:true } });
  if (!row) throw new AppError(401, 'Este dispositivo Mesero fue desautorizado', 'RESTAURANT_WAITER_DEVICE_REVOKED');
  const lastSeen = row.lastNotificationAt ? new Date(row.lastNotificationAt).getTime() : 0;
  if (!lastSeen || Date.now()-lastSeen>=LAST_SEEN_WRITE_INTERVAL_MS) await prisma.trackingLink.update({ where:{ id:row.id }, data:{ lastNotificationAt:new Date() } }).catch(()=>{});
  return true;
}

module.exports = {
  ORIGIN_TYPE,
  ENROLLMENT_ORIGIN_TYPE,
  PAIRING_TTL_MS,
  DEVICE_PERSISTENT_UNTIL,
  LAST_SEEN_WRITE_INTERVAL_MS,
  MAX_ACTIVE_DEVICES_PER_WAITER,
  createPairing,
  inspectPairing,
  claimPairing,
  renewDeviceSession,
  listDevices,
  revokeDevice,
  assertActiveDevice
};
