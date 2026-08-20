const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const SINGLETON_ID = 'META_TECH_PROVIDER';

function secretKey() {
  const seed = process.env.NOTIFICATION_CREDENTIALS_SECRET || process.env.JWT_SECRET;
  if (!seed || String(seed).length < 32) throw new AppError(500, 'NOTIFICATION_CREDENTIALS_SECRET/JWT_SECRET insuficiente', 'NOTIFICATION_SECRET_REQUIRED');
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const [ivRaw, tagRaw, payloadRaw] = String(ciphertext).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64url')), decipher.final()]).toString('utf8');
}

async function getRow(client = prisma) {
  return client.metaTechProviderCredential.findUnique({ where: { id: SINGLETON_ID } });
}

async function getSystemUserToken() {
  const row = await getRow();
  if (!row?.systemUserTokenCiphertext) return null;
  return decrypt(row.systemUserTokenCiphertext);
}

async function saveSystemUserToken({ token, expiresAt = null, label = null, updatedBy = 'PRODUCTION_SETUP' }) {
  if (!token || String(token).length < 20) throw new AppError(400, 'Token de usuario del sistema inválido', 'META_SYSTEM_USER_TOKEN_INVALID');
  const row = await prisma.metaTechProviderCredential.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      systemUserTokenCiphertext: encrypt(token),
      tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
      tokenLabel: label || null,
      configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || null,
      graphVersion: process.env.META_GRAPH_VERSION || null,
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      updatedBy
    },
    update: {
      systemUserTokenCiphertext: encrypt(token),
      tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
      tokenLabel: label || null,
      configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || null,
      graphVersion: process.env.META_GRAPH_VERSION || null,
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      updatedBy
    }
  });
  return publicStatus(row);
}

function publicStatus(row) {
  return {
    configured: Boolean(row?.systemUserTokenCiphertext),
    tokenExpiresAt: row?.tokenExpiresAt || null,
    tokenLabel: row?.tokenLabel || null,
    configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || row?.configurationId || null,
    graphVersion: process.env.META_GRAPH_VERSION || row?.graphVersion || null,
    webhookUrl: `${String(process.env.VANTIXGC_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://core.vantixgc.com').replace(/\/$/, '')}/webhooks/whatsapp`,
    webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    appIdSet: Boolean(process.env.META_APP_ID),
    appSecretSet: Boolean(process.env.META_APP_SECRET),
    lastLiveWebhookAt: row?.lastLiveWebhookAt || null,
    lastAccountUpdateAt: row?.lastAccountUpdateAt || null,
    lastRealSignupAt: row?.lastRealSignupAt || null,
    lastRealMessageSentAt: row?.lastRealMessageSentAt || null
  };
}

async function readiness() {
  const row = await getRow();
  return publicStatus(row);
}

async function touch(fields = {}) {
  return prisma.metaTechProviderCredential.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || null,
      graphVersion: process.env.META_GRAPH_VERSION || null,
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      ...fields
    },
    update: {
      configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || undefined,
      graphVersion: process.env.META_GRAPH_VERSION || undefined,
      webhookVerifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      ...fields
    }
  });
}

module.exports = { getSystemUserToken, saveSystemUserToken, readiness, touch };
