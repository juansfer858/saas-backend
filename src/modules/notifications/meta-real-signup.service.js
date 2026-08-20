const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const notifications = require('./notifications.service');
const meta = require('./providers/meta-cloud.provider');
const techProvider = require('./meta-tech-provider.service');

function targetIdsFromDebug(debug) {
  const ids = new Set();
  for (const scope of debug?.granular_scopes || []) {
    for (const id of scope?.target_ids || []) ids.add(String(id));
  }
  return ids;
}

async function resolvePhone(input, accessToken) {
  if (input.phoneNumberId) return meta.getPhoneNumber({ phoneNumberId: input.phoneNumberId, accessToken });
  const phones = await meta.listPhoneNumbers({ wabaId: input.wabaId, accessToken });
  if (!phones.length) throw new AppError(409, 'Meta no devolvió números para la WABA conectada', 'META_WABA_PHONE_NOT_FOUND');
  if (input.onboardingMode === 'COEXISTENCE') {
    const coexistence = phones.find((phone) => phone.is_on_biz_app === true) || (phones.length === 1 ? phones[0] : null);
    if (!coexistence) throw new AppError(409, 'No fue posible identificar de forma segura el número de WhatsApp Business App conectado', 'META_COEXISTENCE_PHONE_AMBIGUOUS');
    return coexistence;
  }
  if (phones.length !== 1) throw new AppError(409, 'Meta devolvió varios números; se requiere Phone Number ID explícito', 'META_WABA_PHONE_AMBIGUOUS');
  return phones[0];
}

async function completeEmbeddedSignup(tenantId, userId, input) {
  const config = await prisma.notificationTenantConfig.findUnique({ where: { tenantId } })
    || await prisma.notificationTenantConfig.create({ data: { tenantId, providerCode: 'META_CLOUD_API', embeddedSignupVersion: 'v4', trackingExpiryDays: 60 } });
  await prisma.notificationTenantConfig.update({ where: { id: config.id }, data: { connectionState: 'CONNECTING', updatedByUserId: userId } });

  try {
    const tenantToken = await meta.exchangeEmbeddedSignupCode(input.code);
    const systemUserAccessToken = await techProvider.getSystemUserToken();
    if (!systemUserAccessToken) {
      throw new AppError(503, 'Falta el Token de Usuario del Sistema del Tech Provider. Debe cargarse cifrado antes de conectar tenants reales.', 'META_SYSTEM_USER_TOKEN_REQUIRED');
    }

    const debug = await meta.debugAccessToken({ inputToken: tenantToken.accessToken, systemUserAccessToken });
    if (!debug?.is_valid) throw new AppError(401, 'Meta devolvió un business token inválido para Embedded Signup', 'META_EMBEDDED_TOKEN_INVALID');
    const scopes = new Set(debug.scopes || []);
    if (!scopes.has('whatsapp_business_management')) {
      throw new AppError(403, 'El token devuelto por Embedded Signup no incluye whatsapp_business_management', 'META_EMBEDDED_SCOPE_MISSING');
    }
    const targets = targetIdsFromDebug(debug);
    if (targets.size && !targets.has(String(input.wabaId))) {
      throw new AppError(403, 'La WABA devuelta por el popup no pertenece al alcance autorizado del token', 'META_EMBEDDED_WABA_SCOPE_MISMATCH');
    }

    const subscription = await meta.subscribeWaba({ wabaId: input.wabaId, accessToken: systemUserAccessToken });
    const phone = await resolvePhone(input, tenantToken.accessToken);
    if (input.onboardingMode === 'COEXISTENCE' && phone.is_on_biz_app !== true) {
      throw new AppError(409, 'Meta no confirmó coexistencia con WhatsApp Business App para este número', 'META_COEXISTENCE_NOT_CONFIRMED');
    }
    const tokenExpiresAt = tenantToken.expiresIn ? new Date(Date.now() + Number(tenantToken.expiresIn) * 1000) : null;

    await prisma.$transaction(async (tx) => {
      const saved = await tx.notificationTenantConfig.update({
        where: { id: config.id },
        data: {
          providerCode: 'META_CLOUD_API',
          connectionState: 'CONNECTED',
          embeddedSignupVersion: 'v4',
          wabaId: input.wabaId,
          phoneNumberId: String(phone.id || input.phoneNumberId),
          displayPhoneNumber: phone.display_phone_number || null,
          accessTokenCiphertext: notifications.encryptJson({ accessToken: tenantToken.accessToken }),
          tokenExpiresAt,
          webhookSubscribedAt: new Date(),
          connectedAt: new Date(),
          disconnectedAt: null,
          updatedByUserId: userId,
          providerMetadata: {
            verifiedName: phone.verified_name || null,
            qualityRating: phone.quality_rating || null,
            subscription,
            onboardingMode: input.onboardingMode || 'STANDARD',
            coexistence: {
              isOnBusinessApp: phone.is_on_biz_app === true,
              platformType: phone.platform_type || null
            },
            tokenDebug: {
              appId: debug.app_id || null,
              type: debug.type || null,
              expiresAt: debug.expires_at || null,
              dataAccessExpiresAt: debug.data_access_expires_at || null,
              scopes: debug.scopes || [],
              wabaScopeValidated: targets.size ? targets.has(String(input.wabaId)) : null
            }
          }
        }
      });
      await tx.notificationAudit.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId: userId,
          action: input.onboardingMode === 'COEXISTENCE' ? 'WHATSAPP_COEXISTENCE_SIGNUP_COMPLETED' : 'WHATSAPP_REAL_EMBEDDED_SIGNUP_COMPLETED',
          entity: 'NotificationTenantConfig',
          entityId: saved.id,
          metadata: {
            wabaId: input.wabaId,
            phoneNumberId: String(phone.id || input.phoneNumberId),
            embeddedSignupVersion: 'v4',
            onboardingMode: input.onboardingMode || 'STANDARD',
            isOnBusinessApp: phone.is_on_biz_app === true,
            systemUserManagementTokenUsed: true
          }
        }
      });
    });

    await techProvider.touch({ lastRealSignupAt: new Date(), updatedBy: userId });
    return notifications.getPublicConfig(tenantId);
  } catch (error) {
    await prisma.notificationTenantConfig.update({ where: { id: config.id }, data: { connectionState: 'ERROR', updatedByUserId: userId } }).catch(() => {});
    throw error;
  }
}

module.exports = { completeEmbeddedSignup };
