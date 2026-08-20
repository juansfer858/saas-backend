const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const meta = require('./providers/meta-cloud.provider');

const RETRY_MINUTES = [1, 5, 15, 60, 180, 720];
const DEFAULT_EVENTS = [
  { eventCode: 'ORDER_CONFIRMED', marketing: false, requiresConsent: true },
  { eventCode: 'ORDER_READY', marketing: false, requiresConsent: true },
  { eventCode: 'RESERVATION_CONFIRMED', marketing: false, requiresConsent: true },
  { eventCode: 'ACCOUNT_CLOSED_INVOICE', marketing: false, requiresConsent: true },
  { eventCode: 'MARKETING_CAMPAIGN', marketing: true, requiresConsent: true },
  { eventCode: 'TRACKING_STATUS_CHANGED', marketing: false, requiresConsent: true }
];
const STOP_WORDS = new Set(['STOP', 'SALIR', 'BAJA', 'CANCELAR', 'UNSUBSCRIBE']);

function secretKey() {
  const seed = process.env.NOTIFICATION_CREDENTIALS_SECRET || process.env.JWT_SECRET;
  if (!seed || String(seed).length < 32) throw new AppError(500, 'NOTIFICATION_CREDENTIALS_SECRET/JWT_SECRET insuficiente', 'NOTIFICATION_SECRET_REQUIRED');
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function encryptJson(value) {
  if (value === undefined || value === null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptJson(ciphertext) {
  if (!ciphertext) return null;
  const [ivRaw, tagRaw, payloadRaw] = String(ciphertext).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64url')), decipher.final()]).toString('utf8'));
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new AppError(400, 'El teléfono debe enviarse en formato internacional E.164', 'NOTIFICATION_PHONE_INVALID');
  return `+${digits}`;
}

function publicBaseUrl() {
  return String(process.env.VANTIXGC_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://core.vantixgc.com').replace(/\/$/, '');
}

function retryDate(attempt) {
  const minutes = RETRY_MINUTES[Math.min(Math.max(attempt - 1, 0), RETRY_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60 * 1000);
}

function providerFor(code) {
  if (code === 'META_CLOUD_API') return meta;
  throw new AppError(409, `Proveedor de notificaciones no instalado: ${code}`, 'NOTIFICATION_PROVIDER_NOT_INSTALLED');
}

async function audit(tenantId, actorType, actorId, action, entity, entityId, metadata = null, client = prisma) {
  return client.notificationAudit.create({ data: { tenantId, actorType, actorId: actorId || null, action, entity, entityId: entityId || null, metadata } });
}

async function getOrCreateConfig(tenantId, client = prisma) {
  let row = await client.notificationTenantConfig.findUnique({ where: { tenantId } });
  if (!row) row = await client.notificationTenantConfig.create({ data: { tenantId, providerCode: 'META_CLOUD_API', embeddedSignupVersion: 'v4', trackingExpiryDays: 60 } });
  return row;
}

function publicConfig(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerCode: row.providerCode,
    connectionState: row.connectionState,
    embeddedSignupVersion: row.embeddedSignupVersion,
    connected: row.connectionState === 'CONNECTED' && Boolean(row.phoneNumberId && row.accessTokenCiphertext),
    wabaConfigured: Boolean(row.wabaId),
    phoneNumberConfigured: Boolean(row.phoneNumberId),
    displayPhoneNumber: row.displayPhoneNumber,
    tokenConfigured: Boolean(row.accessTokenCiphertext),
    tokenExpiresAt: row.tokenExpiresAt,
    webhookSubscribedAt: row.webhookSubscribedAt,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    trackingExpiryDays: row.trackingExpiryDays,
    fallbackHumanContact: row.fallbackHumanContact,
    actualizadoEn: row.actualizadoEn
  };
}

async function getPublicConfig(tenantId) {
  return publicConfig(await getOrCreateConfig(tenantId));
}

async function saveGeneralConfig(tenantId, userId, input) {
  const row = await prisma.notificationTenantConfig.upsert({
    where: { tenantId },
    create: {
      tenantId,
      providerCode: 'META_CLOUD_API',
      embeddedSignupVersion: 'v4',
      trackingExpiryDays: input.trackingExpiryDays || 60,
      fallbackHumanContact: input.fallbackHumanContact || null,
      updatedByUserId: userId
    },
    update: {
      trackingExpiryDays: input.trackingExpiryDays,
      fallbackHumanContact: input.fallbackHumanContact || null,
      updatedByUserId: userId
    }
  });
  await audit(tenantId, 'USER', userId, 'NOTIFICATION_CONFIG_UPDATED', 'NotificationTenantConfig', row.id, { trackingExpiryDays: row.trackingExpiryDays });
  return publicConfig(row);
}

async function embeddedSignupPublicConfig() {
  return meta.embeddedSignupConfig();
}

async function completeEmbeddedSignup(tenantId, userId, input) {
  const config = await getOrCreateConfig(tenantId);
  await prisma.notificationTenantConfig.update({ where: { id: config.id }, data: { connectionState: 'CONNECTING', updatedByUserId: userId } });
  try {
    const token = await meta.exchangeEmbeddedSignupCode(input.code);
    const [subscription, phone] = await Promise.all([
      meta.subscribeWaba({ wabaId: input.wabaId, accessToken: token.accessToken }),
      meta.getPhoneNumber({ phoneNumberId: input.phoneNumberId, accessToken: token.accessToken })
    ]);
    const tokenExpiresAt = token.expiresIn ? new Date(Date.now() + Number(token.expiresIn) * 1000) : null;
    const row = await prisma.notificationTenantConfig.update({
      where: { id: config.id },
      data: {
        providerCode: 'META_CLOUD_API',
        connectionState: 'CONNECTED',
        embeddedSignupVersion: 'v4',
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: phone.display_phone_number || null,
        accessTokenCiphertext: encryptJson({ accessToken: token.accessToken }),
        tokenExpiresAt,
        webhookSubscribedAt: new Date(),
        connectedAt: new Date(),
        disconnectedAt: null,
        updatedByUserId: userId,
        providerMetadata: { verifiedName: phone.verified_name || null, qualityRating: phone.quality_rating || null, subscription }
      }
    });
    await audit(tenantId, 'USER', userId, 'WHATSAPP_CONNECTED', 'NotificationTenantConfig', row.id, { phoneNumberId: input.phoneNumberId, embeddedSignupVersion: 'v4' });
    return publicConfig(row);
  } catch (error) {
    await prisma.notificationTenantConfig.update({ where: { id: config.id }, data: { connectionState: 'ERROR', updatedByUserId: userId } });
    throw error;
  }
}

async function disconnectWhatsApp(tenantId, userId) {
  const row = await getOrCreateConfig(tenantId);
  let revoke = { attempted: false };
  if (row.accessTokenCiphertext) {
    const token = decryptJson(row.accessTokenCiphertext);
    revoke = await meta.revokeAccess({ accessToken: token.accessToken });
  }
  const updated = await prisma.notificationTenantConfig.update({
    where: { id: row.id },
    data: {
      connectionState: 'DISCONNECTED',
      wabaId: null,
      phoneNumberId: null,
      displayPhoneNumber: null,
      accessTokenCiphertext: null,
      tokenExpiresAt: null,
      webhookSubscribedAt: null,
      disconnectedAt: new Date(),
      updatedByUserId: userId,
      providerMetadata: null
    }
  });
  await audit(tenantId, 'USER', userId, 'WHATSAPP_DISCONNECTED', 'NotificationTenantConfig', row.id, { providerRevocation: revoke });
  return { ...publicConfig(updated), providerRevocation: revoke };
}

async function ensureDefaultEventRules(tenantId) {
  for (const item of DEFAULT_EVENTS) {
    await prisma.notificationEventRule.upsert({
      where: { tenantId_eventCode_channel: { tenantId, eventCode: item.eventCode, channel: 'WHATSAPP' } },
      create: { tenantId, eventCode: item.eventCode, channel: 'WHATSAPP', enabled: false, marketing: item.marketing, requiresConsent: item.requiresConsent },
      update: { marketing: item.marketing, requiresConsent: item.requiresConsent }
    });
  }
}

async function listEventRules(tenantId) {
  await ensureDefaultEventRules(tenantId);
  const [rules, templates] = await Promise.all([
    prisma.notificationEventRule.findMany({ where: { tenantId }, orderBy: { eventCode: 'asc' } }),
    prisma.notificationTemplate.findMany({ where: { tenantId }, select: { id: true, name: true, languageCode: true, state: true, category: true } })
  ]);
  const byId = new Map(templates.map((x) => [x.id, x]));
  return rules.map((rule) => ({ ...rule, template: rule.templateId ? byId.get(rule.templateId) || null : null }));
}

async function saveEventRule(tenantId, userId, eventCode, input) {
  await ensureDefaultEventRules(tenantId);
  let template = null;
  if (input.templateId) template = await prisma.notificationTemplate.findFirst({ where: { id: input.templateId, tenantId } });
  if (input.enabled) {
    if (!template) throw new AppError(409, 'Seleccione una plantilla antes de activar el evento', 'NOTIFICATION_TEMPLATE_REQUIRED');
    if (template.state !== 'APPROVED') throw new AppError(409, 'El evento no puede activarse hasta que Meta apruebe su plantilla', 'NOTIFICATION_TEMPLATE_NOT_APPROVED');
  }
  const existing = await prisma.notificationEventRule.findUnique({ where: { tenantId_eventCode_channel: { tenantId, eventCode, channel: 'WHATSAPP' } } });
  if (!existing) throw new AppError(404, 'Evento de notificación no encontrado', 'NOTIFICATION_EVENT_NOT_FOUND');
  const updated = await prisma.notificationEventRule.update({
    where: { id: existing.id },
    data: { enabled: Boolean(input.enabled), templateId: input.templateId || null, updatedByUserId: userId }
  });
  await audit(tenantId, 'USER', userId, 'NOTIFICATION_EVENT_UPDATED', 'NotificationEventRule', updated.id, { eventCode, enabled: updated.enabled, templateId: updated.templateId });
  return updated;
}

async function listTemplates(tenantId) {
  return prisma.notificationTemplate.findMany({ where: { tenantId }, orderBy: [{ state: 'asc' }, { name: 'asc' }] });
}

async function createTemplate(tenantId, userId, input) {
  const row = await prisma.notificationTemplate.create({
    data: {
      tenantId,
      channel: 'WHATSAPP',
      name: input.name,
      languageCode: input.languageCode || 'es_CO',
      category: input.category,
      bodyText: input.bodyText,
      variables: input.variables || null,
      createdByUserId: userId
    }
  });
  await audit(tenantId, 'USER', userId, 'NOTIFICATION_TEMPLATE_CREATED', 'NotificationTemplate', row.id, { name: row.name, category: row.category });
  return row;
}

async function connectedProviderConfig(tenantId) {
  const config = await getOrCreateConfig(tenantId);
  if (config.connectionState !== 'CONNECTED' || !config.accessTokenCiphertext || !config.wabaId || !config.phoneNumberId) {
    throw new AppError(409, 'Conecte primero el WhatsApp Business del tenant', 'NOTIFICATION_WHATSAPP_NOT_CONNECTED');
  }
  const token = decryptJson(config.accessTokenCiphertext);
  return { config, accessToken: token.accessToken, provider: providerFor(config.providerCode) };
}

async function submitTemplate(tenantId, userId, templateId) {
  const template = await prisma.notificationTemplate.findFirst({ where: { id: templateId, tenantId } });
  if (!template) throw new AppError(404, 'Plantilla no encontrada', 'NOTIFICATION_TEMPLATE_NOT_FOUND');
  if (!['DRAFT', 'REJECTED'].includes(template.state)) throw new AppError(409, 'La plantilla ya fue enviada a Meta', 'NOTIFICATION_TEMPLATE_ALREADY_SUBMITTED');
  const { config, accessToken, provider } = await connectedProviderConfig(tenantId);
  const result = await provider.createTemplate({ wabaId: config.wabaId, accessToken, template });
  const updated = await prisma.notificationTemplate.update({
    where: { id: template.id },
    data: { providerTemplateId: result.id ? String(result.id) : template.providerTemplateId, providerTemplateName: template.name, state: 'PENDING', rejectedReason: null, lastProviderSyncAt: new Date() }
  });
  await audit(tenantId, 'USER', userId, 'NOTIFICATION_TEMPLATE_SUBMITTED', 'NotificationTemplate', updated.id, { providerTemplateId: updated.providerTemplateId });
  return updated;
}

function providerTemplateState(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'APPROVED') return 'APPROVED';
  if (value === 'REJECTED') return 'REJECTED';
  if (['DISABLED', 'PAUSED'].includes(value)) return 'DISABLED';
  return 'PENDING';
}

async function syncTemplateStates(tenantId, userId) {
  const { config, accessToken, provider } = await connectedProviderConfig(tenantId);
  const providerTemplates = await provider.listTemplates({ wabaId: config.wabaId, accessToken });
  const local = await prisma.notificationTemplate.findMany({ where: { tenantId, channel: 'WHATSAPP' } });
  const byNameLanguage = new Map(providerTemplates.map((x) => [`${x.name}|${x.language}`, x]));
  const updated = [];
  for (const template of local) {
    const remote = byNameLanguage.get(`${template.providerTemplateName || template.name}|${template.languageCode}`);
    if (!remote) continue;
    const row = await prisma.notificationTemplate.update({
      where: { id: template.id },
      data: {
        providerTemplateId: remote.id ? String(remote.id) : template.providerTemplateId,
        providerTemplateName: remote.name || template.providerTemplateName || template.name,
        state: providerTemplateState(remote.status),
        rejectedReason: remote.rejected_reason || null,
        lastProviderSyncAt: new Date()
      }
    });
    updated.push(row);
  }
  await audit(tenantId, 'USER', userId, 'NOTIFICATION_TEMPLATE_STATUS_SYNC', 'NotificationTemplate', null, { count: updated.length });
  return updated;
}

async function setConsent(tenantId, userId, input, state = 'GRANTED') {
  const phoneE164 = normalizePhone(input.phoneE164);
  const scope = String(input.scope || 'TRANSACTIONAL').toUpperCase();
  if (!['TRANSACTIONAL', 'MARKETING', 'ALL'].includes(scope)) throw new AppError(400, 'Scope de consentimiento inválido', 'NOTIFICATION_CONSENT_SCOPE_INVALID');
  const now = new Date();
  const row = await prisma.notificationConsent.upsert({
    where: { tenantId_phoneE164_scope: { tenantId, phoneE164, scope } },
    create: {
      tenantId,
      terceroId: input.terceroId || null,
      phoneE164,
      scope,
      state,
      source: input.source,
      evidence: input.evidence || null,
      grantedAt: state === 'GRANTED' ? now : now,
      revokedAt: state === 'REVOKED' ? now : null,
      createdByUserId: userId || null
    },
    update: {
      terceroId: input.terceroId || null,
      state,
      source: input.source,
      evidence: input.evidence || null,
      grantedAt: state === 'GRANTED' ? now : undefined,
      revokedAt: state === 'REVOKED' ? now : null,
      createdByUserId: userId || null
    }
  });
  await audit(tenantId, userId ? 'USER' : 'CUSTOMER', userId || phoneE164, state === 'GRANTED' ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED', 'NotificationConsent', row.id, { phoneE164, scope, source: input.source });
  return row;
}

async function grantConsent(tenantId, userId, input) {
  return setConsent(tenantId, userId, input, 'GRANTED');
}

async function revokeConsent(tenantId, userId, input) {
  return setConsent(tenantId, userId, input, 'REVOKED');
}

async function hasConsent(tenantId, phoneE164, marketing = false) {
  const phone = normalizePhone(phoneE164);
  const scopes = marketing ? ['MARKETING', 'ALL'] : ['TRANSACTIONAL', 'ALL'];
  const row = await prisma.notificationConsent.findFirst({ where: { tenantId, phoneE164: phone, scope: { in: scopes }, state: 'GRANTED' } });
  return Boolean(row);
}

async function resolveFiscalRepresentation(tenantId, dianDocumentId) {
  if (!dianDocumentId) return null;
  const doc = await prisma.dianDocument.findFirst({ where: { id: dianDocumentId, tenantId } });
  if (!doc) throw new AppError(404, 'Documento DIAN no encontrado', 'NOTIFICATION_DIAN_DOCUMENT_NOT_FOUND');
  const response = doc.providerResponse || {};
  const representationUrl = response.representationUrl || response.pdfUrl || response.documentUrl || response?.representation?.url || null;
  if (!representationUrl) {
    throw new AppError(409, 'El documento DIAN aún no tiene una representación gráfica/PDF canónica disponible; Notificaciones no generará una copia paralela', 'NOTIFICATION_DIAN_REPRESENTATION_REQUIRED');
  }
  return { dianDocumentId: doc.id, fiscalNumber: doc.fiscalNumber, representationUrl };
}

async function enqueueEventNotification(tenantId, input) {
  const phone = normalizePhone(input.recipientPhoneE164);
  const rule = await prisma.notificationEventRule.findUnique({ where: { tenantId_eventCode_channel: { tenantId, eventCode: input.eventCode, channel: 'WHATSAPP' } } });
  if (!rule?.enabled) return { queued: false, reason: 'EVENT_DISABLED' };
  const template = rule.templateId ? await prisma.notificationTemplate.findFirst({ where: { id: rule.templateId, tenantId } }) : null;
  if (!template || template.state !== 'APPROVED') throw new AppError(409, 'La plantilla del evento no está aprobada', 'NOTIFICATION_TEMPLATE_NOT_APPROVED');
  if (rule.requiresConsent && !(await hasConsent(tenantId, phone, rule.marketing))) return { queued: false, reason: 'CONSENT_REQUIRED' };
  const config = await getOrCreateConfig(tenantId);
  if (config.connectionState !== 'CONNECTED') throw new AppError(409, 'WhatsApp Business no está conectado', 'NOTIFICATION_WHATSAPP_NOT_CONNECTED');
  const fiscalRepresentation = await resolveFiscalRepresentation(tenantId, input.dianDocumentId || null);
  const tracking = input.trackingLinkId ? await prisma.trackingLink.findFirst({ where: { id: input.trackingLinkId, tenantId } }) : null;
  const trackingUrl = tracking ? publicTrackingUrl(tracking) : null;
  const parameters = [...(input.parameters || [])];
  if (trackingUrl && input.appendTrackingUrl !== false) parameters.push(trackingUrl);
  const message = await prisma.notificationMessage.create({
    data: {
      tenantId,
      channel: 'WHATSAPP',
      providerCode: config.providerCode,
      recipientPhoneE164: phone,
      eventCode: input.eventCode,
      templateId: template.id,
      originType: input.originType || null,
      originId: input.originId || null,
      trackingLinkId: tracking?.id || null,
      dianDocumentId: fiscalRepresentation?.dianDocumentId || null,
      state: 'QUEUED',
      nextRetryAt: new Date(),
      payload: {
        templateName: template.providerTemplateName || template.name,
        languageCode: template.languageCode,
        parameters,
        fiscalRepresentation,
        trackingUrl
      }
    }
  });
  return { queued: true, messageId: message.id, state: message.state };
}

async function sendMessage(message) {
  const config = await prisma.notificationTenantConfig.findUnique({ where: { tenantId: message.tenantId } });
  if (!config || config.connectionState !== 'CONNECTED' || !config.accessTokenCiphertext || !config.phoneNumberId) {
    throw Object.assign(new Error('WhatsApp del tenant no está conectado'), { retryable: true, code: 'NOTIFICATION_PROVIDER_DISCONNECTED' });
  }
  const provider = providerFor(config.providerCode);
  const accessToken = decryptJson(config.accessTokenCiphertext)?.accessToken;
  const payload = message.payload || {};
  const started = Date.now();
  const attempt = message.retryCount + 1;
  await prisma.notificationMessage.update({ where: { id: message.id }, data: { state: 'SENDING' } });
  try {
    const sent = await provider.sendTemplate({
      phoneNumberId: config.phoneNumberId,
      accessToken,
      to: message.recipientPhoneE164,
      templateName: payload.templateName,
      languageCode: payload.languageCode,
      parameters: payload.parameters || []
    });
    let documentSent = null;
    if (payload.fiscalRepresentation?.representationUrl) {
      documentSent = await provider.sendDocument({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: message.recipientPhoneE164,
        link: payload.fiscalRepresentation.representationUrl,
        filename: `${payload.fiscalRepresentation.fiscalNumber || 'documento'}.pdf`,
        caption: 'Documento electrónico / representación gráfica'
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.notificationDeliveryAttempt.create({
        data: {
          notificationMessageId: message.id,
          attempt,
          result: 'SUCCESS',
          providerResponse: { template: sent.raw, document: documentSent?.raw || null, canonicalDianRepresentationUrl: payload.fiscalRepresentation?.representationUrl || null },
          durationMs: Date.now() - started
        }
      });
      await tx.notificationMessage.update({
        where: { id: message.id },
        data: { state: 'SENT', providerMessageId: sent.providerMessageId, retryCount: attempt, nextRetryAt: null, lastError: null, sentAt: new Date(), failedAt: null }
      });
    });
    return { id: message.id, ok: true, providerMessageId: sent.providerMessageId };
  } catch (error) {
    const retryable = error.retryable !== false;
    await prisma.$transaction(async (tx) => {
      await tx.notificationDeliveryAttempt.create({
        data: {
          notificationMessageId: message.id,
          attempt,
          result: retryable ? 'RETRYABLE_ERROR' : 'DEFINITIVE_ERROR',
          httpStatus: error.httpStatus || null,
          providerResponse: error.providerBody || null,
          errorMessage: error.message,
          durationMs: Date.now() - started
        }
      });
      await tx.notificationMessage.update({
        where: { id: message.id },
        data: {
          state: 'FAILED',
          retryCount: attempt,
          nextRetryAt: retryable ? retryDate(attempt) : null,
          lastError: error.message,
          failedAt: new Date()
        }
      });
    });
    return { id: message.id, ok: false, retryable, error: error.message };
  }
}

async function processQueue(limit = 25) {
  const due = await prisma.notificationMessage.findMany({
    where: { state: { in: ['QUEUED', 'FAILED'] }, nextRetryAt: { lte: new Date() } },
    orderBy: [{ nextRetryAt: 'asc' }, { queuedAt: 'asc' }],
    take: Math.min(Number(limit) || 25, 100)
  });
  const results = [];
  for (const message of due) results.push(await sendMessage(message));
  return results;
}

async function listMessages(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.state) where.state = filters.state;
  if (filters.eventCode) where.eventCode = filters.eventCode;
  return prisma.notificationMessage.findMany({ where, orderBy: { creadoEn: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
}

async function updateProviderStatus(providerMessageId, status, raw) {
  if (!providerMessageId) return null;
  const message = await prisma.notificationMessage.findFirst({ where: { providerMessageId } });
  if (!message) return null;
  const s = String(status || '').toLowerCase();
  let data = {};
  if (s === 'sent') data = { state: 'SENT', sentAt: message.sentAt || new Date() };
  else if (s === 'delivered') data = { state: 'DELIVERED', deliveredAt: new Date() };
  else if (s === 'read') data = { state: 'READ', readAt: new Date(), deliveredAt: message.deliveredAt || new Date() };
  else if (s === 'failed') data = { state: 'FAILED', failedAt: new Date(), nextRetryAt: retryDate(message.retryCount + 1), lastError: raw?.errors?.[0]?.title || raw?.errors?.[0]?.message || 'Meta reportó fallo de entrega' };
  else return message;
  return prisma.notificationMessage.update({ where: { id: message.id }, data });
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function decryptTrackingToken(link) {
  return decryptJson(link.tokenCiphertext)?.token;
}

function publicTrackingUrl(link) {
  const token = decryptTrackingToken(link);
  return `${publicBaseUrl()}/seguimiento/${encodeURIComponent(token)}`;
}

async function createTrackingLink(tenantId, userId, input) {
  const existing = await prisma.trackingLink.findUnique({ where: { tenantId_originType_originId: { tenantId, originType: input.originType, originId: input.originId } } });
  if (existing) return { ...existing, publicUrl: publicTrackingUrl(existing) };
  const config = await getOrCreateConfig(tenantId);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const farFuture = new Date(now.getTime() + 3650 * 86400000);
  const row = await prisma.trackingLink.create({
    data: {
      tenantId,
      tokenHash: tokenHash(token),
      tokenCiphertext: encryptJson({ token }),
      tokenHint: token.slice(0, 8),
      originType: input.originType,
      originId: input.originId,
      publicReference: input.publicReference,
      currentStatus: input.currentStatus,
      timeline: [{ status: input.currentStatus, at: now.toISOString(), note: input.note || null }],
      customerPhoneE164: input.customerPhoneE164 ? normalizePhone(input.customerPhoneE164) : null,
      expiresAt: input.expiresAt || farFuture,
      createdByUserId: userId || null
    }
  });
  await audit(tenantId, 'USER', userId, 'TRACKING_LINK_CREATED', 'TrackingLink', row.id, { originType: input.originType, originId: input.originId, publicReference: input.publicReference });
  return { ...row, publicUrl: `${publicBaseUrl()}/seguimiento/${encodeURIComponent(token)}` };
}

async function getPublicTracking(token) {
  const hash = tokenHash(token);
  const row = await prisma.trackingLink.findUnique({ where: { tokenHash: hash } });
  if (!row) throw new AppError(404, 'Enlace de seguimiento no encontrado', 'TRACKING_LINK_NOT_FOUND');
  const expired = !row.active || row.expiresAt <= new Date();
  return {
    expired,
    tenantId: row.tenantId,
    reference: row.publicReference,
    status: expired ? 'EXPIRADO' : row.currentStatus,
    timeline: expired ? [] : (Array.isArray(row.timeline) ? row.timeline : []),
    completedAt: row.completedAt,
    expiresAt: row.expiresAt
  };
}

async function updateTrackingStatus(tenantId, userId, linkId, input) {
  const row = await prisma.trackingLink.findFirst({ where: { id: linkId, tenantId } });
  if (!row) throw new AppError(404, 'Enlace de seguimiento no encontrado', 'TRACKING_LINK_NOT_FOUND');
  const timeline = Array.isArray(row.timeline) ? [...row.timeline] : [];
  timeline.push({ status: input.status, at: new Date().toISOString(), note: input.note || null });
  const config = await getOrCreateConfig(tenantId);
  const completedAt = input.completed ? new Date() : row.completedAt;
  const expiresAt = input.completed ? new Date(Date.now() + config.trackingExpiryDays * 86400000) : row.expiresAt;
  const updated = await prisma.trackingLink.update({ where: { id: row.id }, data: { currentStatus: input.status, timeline, completedAt, expiresAt } });
  await audit(tenantId, 'USER', userId, 'TRACKING_STATUS_CHANGED', 'TrackingLink', row.id, { status: input.status, completed: Boolean(input.completed) });
  let notification = { queued: false, reason: 'NO_PHONE' };
  if (updated.customerPhoneE164) {
    notification = await enqueueEventNotification(tenantId, {
      eventCode: 'TRACKING_STATUS_CHANGED',
      recipientPhoneE164: updated.customerPhoneE164,
      originType: updated.originType,
      originId: updated.originId,
      trackingLinkId: updated.id,
      parameters: [updated.publicReference, updated.currentStatus]
    });
    if (notification.queued) await prisma.trackingLink.update({ where: { id: updated.id }, data: { lastNotificationAt: new Date() } });
  }
  return { ...updated, publicUrl: publicTrackingUrl(updated), notification };
}

async function findActiveTrackingForPhone(tenantId, phoneE164) {
  const phone = normalizePhone(phoneE164);
  return prisma.trackingLink.findMany({
    where: { tenantId, customerPhoneE164: phone, active: true, expiresAt: { gt: new Date() }, completedAt: null },
    orderBy: { actualizadoEn: 'desc' },
    take: 5
  });
}

async function sendInboundReply(config, to, text) {
  const accessToken = decryptJson(config.accessTokenCiphertext)?.accessToken;
  return providerFor(config.providerCode).sendText({ phoneNumberId: config.phoneNumberId, accessToken, to, text });
}

async function revokeAllByCustomerMessage(tenantId, phoneE164) {
  const phone = normalizePhone(phoneE164);
  for (const scope of ['TRANSACTIONAL', 'MARKETING', 'ALL']) {
    await setConsent(tenantId, null, { phoneE164: phone, scope, source: 'WHATSAPP_STOP', evidence: { inboundKeyword: 'STOP_OR_EQUIVALENT' } }, 'REVOKED');
  }
}

async function handleInboundMessage(config, message, rawPayload) {
  const providerMessageId = message.id;
  if (!providerMessageId) return null;
  const existing = await prisma.notificationInboundMessage.findUnique({ where: { providerMessageId } });
  if (existing) return existing;
  const phone = normalizePhone(message.from);
  const text = message.text?.body || '';
  const inbound = await prisma.notificationInboundMessage.create({
    data: {
      tenantId: config.tenantId,
      providerMessageId,
      phoneNumberId: config.phoneNumberId,
      senderPhoneE164: phone,
      messageType: message.type || 'unknown',
      textBody: text || null,
      rawPayload
    }
  });
  let action = 'TRACKING_LOOKUP';
  let responseText;
  if (STOP_WORDS.has(text.trim().toUpperCase())) {
    action = 'OPT_OUT';
    await revokeAllByCustomerMessage(config.tenantId, phone);
    responseText = 'Listo. No recibirás más notificaciones automáticas de este negocio. Puedes volver a autorizar comunicaciones cuando quieras.';
  } else {
    const links = await findActiveTrackingForPhone(config.tenantId, phone);
    if (links.length === 1) {
      responseText = `Tu pedido ${links[0].publicReference} está en estado: ${links[0].currentStatus}. Seguimiento: ${publicTrackingUrl(links[0])}`;
    } else if (links.length > 1) {
      responseText = `Encontré ${links.length} pedidos activos:\n${links.map((x) => `${x.publicReference}: ${x.currentStatus} · ${publicTrackingUrl(x)}`).join('\n')}`;
    } else {
      action = 'NO_ACTIVE_ORDER';
      responseText = config.fallbackHumanContact || 'No encontré un pedido activo asociado a este número. Por favor contacta al negocio para recibir ayuda.';
    }
  }
  const sent = await sendInboundReply(config, phone, responseText);
  return prisma.notificationInboundMessage.update({ where: { id: inbound.id }, data: { action, responseMessageId: sent.providerMessageId, handledAt: new Date() } });
}

async function handleWhatsAppWebhook(payload) {
  const entries = payload?.entry || [];
  const outcomes = [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const config = await prisma.notificationTenantConfig.findFirst({ where: { phoneNumberId, connectionState: 'CONNECTED' } });
      if (!config) continue;
      for (const status of value.statuses || []) {
        outcomes.push(await updateProviderStatus(status.id, status.status, status));
      }
      for (const message of value.messages || []) {
        outcomes.push(await handleInboundMessage(config, message, payload));
      }
    }
  }
  return outcomes.filter(Boolean);
}

async function verifyWebhook(mode, token, challenge) {
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) return challenge;
  throw new AppError(403, 'Verificación de webhook Meta rechazada', 'META_WEBHOOK_VERIFY_FAILED');
}

async function listTrackingLinks(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.originType) where.originType = filters.originType;
  if (filters.active !== undefined) where.active = filters.active;
  const rows = await prisma.trackingLink.findMany({ where, orderBy: { actualizadoEn: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
  return rows.map((row) => ({ ...row, tokenCiphertext: undefined, tokenHash: undefined, publicUrl: publicTrackingUrl(row) }));
}

async function listAudits(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.entity) where.entity = filters.entity;
  return prisma.notificationAudit.findMany({ where, orderBy: { creadoEn: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
}

module.exports = {
  DEFAULT_EVENTS,
  normalizePhone,
  getPublicConfig,
  saveGeneralConfig,
  embeddedSignupPublicConfig,
  completeEmbeddedSignup,
  disconnectWhatsApp,
  ensureDefaultEventRules,
  listEventRules,
  saveEventRule,
  listTemplates,
  createTemplate,
  submitTemplate,
  syncTemplateStates,
  grantConsent,
  revokeConsent,
  hasConsent,
  enqueueEventNotification,
  processQueue,
  listMessages,
  updateProviderStatus,
  createTrackingLink,
  getPublicTracking,
  updateTrackingStatus,
  listTrackingLinks,
  handleWhatsAppWebhook,
  verifyWebhook,
  listAudits,
  resolveFiscalRepresentation,
  publicTrackingUrl,
  encryptJson,
  decryptJson
};
