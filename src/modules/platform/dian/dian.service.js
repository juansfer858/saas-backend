const crypto = require('node:crypto');
const { prisma } = require('../../../config/prisma');
const { AppError } = require('../../../utils/app-error');

const RETRY_MINUTES = [1, 5, 15, 60, 180, 720];

function secretKey() {
  const seed = process.env.DIAN_CREDENTIALS_SECRET || process.env.JWT_SECRET || 'vantixgc-dev-dian-secret';
  return crypto.createHash('sha256').update(seed).digest();
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
  const clear = Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64url')), decipher.final()]);
  return JSON.parse(clear.toString('utf8'));
}

function publicConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerCode: row.providerCode,
    providerName: row.providerName,
    environment: row.environment,
    habilitacionBaseUrl: row.habilitacionBaseUrl,
    produccionBaseUrl: row.produccionBaseUrl,
    credentialsConfigured: Boolean(row.credentialCiphertext),
    certificateAlias: row.certificateAlias,
    certificateExpiresAt: row.certificateExpiresAt,
    certificateFingerprint: row.certificateFingerprint,
    invoiceEnabled: row.invoiceEnabled,
    payrollEnabled: row.payrollEnabled,
    contingencyEnabled: row.contingencyEnabled,
    habilitacionChecklist: row.habilitacionChecklist,
    actualizadoEn: row.actualizadoEn
  };
}

async function getConfig(tenantId, client = prisma) {
  return client.dianTenantConfig.findUnique({ where: { tenantId } });
}

async function saveConfig(tenantId, userId, input) {
  const previous = await getConfig(tenantId);
  if (input.providerCode === 'MOCK_PT' && input.environment === 'PRODUCCION') {
    throw new AppError(409, 'El adaptador MOCK_PT solo puede usarse en habilitación', 'DIAN_MOCK_PRODUCTION_FORBIDDEN');
  }
  const data = {
    providerCode: input.providerCode,
    providerName: input.providerName,
    environment: input.environment,
    habilitacionBaseUrl: input.habilitacionBaseUrl || null,
    produccionBaseUrl: input.produccionBaseUrl || null,
    certificateAlias: input.certificateAlias || null,
    certificateExpiresAt: input.certificateExpiresAt || null,
    certificateFingerprint: input.certificateFingerprint || null,
    invoiceEnabled: Boolean(input.invoiceEnabled),
    payrollEnabled: Boolean(input.payrollEnabled),
    contingencyEnabled: input.contingencyEnabled !== false,
    habilitacionChecklist: input.habilitacionChecklist || previous?.habilitacionChecklist || null,
    updatedByUserId: userId
  };
  if (Object.prototype.hasOwnProperty.call(input, 'credentials')) data.credentialCiphertext = encryptJson(input.credentials);
  const row = await prisma.dianTenantConfig.upsert({
    where: { tenantId },
    create: { tenantId, credentialCiphertext: data.credentialCiphertext || null, ...data },
    update: data
  });
  return publicConfig(row);
}

async function getPublicConfig(tenantId) {
  return publicConfig(await getConfig(tenantId));
}

async function listNumberingRanges(tenantId) {
  return prisma.dianNumberingRange.findMany({ where: { tenantId }, orderBy: [{ documentType: 'asc' }, { prefix: 'asc' }] });
}

async function saveNumberingRange(tenantId, input) {
  if (input.rangeTo < input.rangeFrom) throw new AppError(400, 'El rango final debe ser mayor o igual al inicial', 'DIAN_NUMBER_RANGE_INVALID');
  const nextNumber = input.nextNumber ?? input.rangeFrom;
  if (nextNumber < input.rangeFrom || nextNumber > input.rangeTo + 1) throw new AppError(400, 'Siguiente consecutivo fuera del rango', 'DIAN_NUMBER_NEXT_INVALID');
  return prisma.dianNumberingRange.upsert({
    where: { tenantId_documentType_prefix: { tenantId, documentType: input.documentType, prefix: input.prefix } },
    create: {
      tenantId,
      documentType: input.documentType,
      prefix: input.prefix,
      rangeFrom: input.rangeFrom,
      rangeTo: input.rangeTo,
      nextNumber,
      authorizationNumber: input.authorizationNumber || null,
      validFrom: input.validFrom || null,
      validUntil: input.validUntil || null,
      active: input.active !== false
    },
    update: {
      rangeFrom: input.rangeFrom,
      rangeTo: input.rangeTo,
      nextNumber,
      authorizationNumber: input.authorizationNumber || null,
      validFrom: input.validFrom || null,
      validUntil: input.validUntil || null,
      active: input.active !== false
    }
  });
}

async function reserveFiscalNumberInTx(tx, tenantId, documentType, date = new Date()) {
  const range = await tx.dianNumberingRange.findFirst({
    where: { tenantId, documentType, active: true },
    orderBy: { creadoEn: 'asc' }
  });
  if (!range) throw new AppError(409, `Configure la numeración DIAN para ${documentType} antes de continuar`, 'DIAN_NUMBERING_REQUIRED', { documentType });
  if (range.validFrom && date < range.validFrom) throw new AppError(409, 'La numeración DIAN aún no está vigente', 'DIAN_NUMBERING_NOT_YET_VALID');
  if (range.validUntil && date > range.validUntil) throw new AppError(409, 'La numeración DIAN configurada está vencida', 'DIAN_NUMBERING_EXPIRED');
  if (range.nextNumber > range.rangeTo) throw new AppError(409, 'La numeración DIAN configurada está agotada', 'DIAN_NUMBERING_EXHAUSTED');
  const updated = await tx.dianNumberingRange.update({
    where: { id: range.id },
    data: { nextNumber: { increment: 1 } }
  });
  const used = updated.nextNumber - 1;
  return {
    rangeId: range.id,
    number: used,
    fiscalNumber: `${range.prefix || ''}${used}`,
    authorizationNumber: range.authorizationNumber
  };
}

function featureEnabled(config, type) {
  if (type === 'NOMINA_ELECTRONICA') return config.payrollEnabled;
  return config.invoiceEnabled;
}

async function enqueueInTx(tx, params) {
  const config = await getConfig(params.tenantId, tx);
  if (!config || !featureEnabled(config, params.documentType)) return null;
  const existing = await tx.dianDocument.findFirst({
    where: {
      tenantId: params.tenantId,
      documentType: params.documentType,
      originType: params.originType,
      originId: params.originId
    }
  });
  if (existing) return existing;
  const numbering = await reserveFiscalNumberInTx(tx, params.tenantId, params.documentType, params.date || new Date());
  return tx.dianDocument.create({
    data: {
      tenantId: params.tenantId,
      documentType: params.documentType,
      state: 'PENDIENTE_ENVIO',
      environment: config.environment,
      originType: params.originType,
      originId: params.originId,
      internalNumber: params.internalNumber || null,
      fiscalNumber: numbering.fiscalNumber,
      providerResponse: params.snapshot ? { sourceSnapshot: params.snapshot, authorizationNumber: numbering.authorizationNumber } : { authorizationNumber: numbering.authorizationNumber },
      nextRetryAt: new Date()
    }
  });
}

async function enqueueCommercialInTx(tx, params) {
  if (params.comprobante.tipo !== 'FACTURA_VENTA') return null;
  return enqueueInTx(tx, {
    tenantId: params.tenantId,
    documentType: params.documentType || 'DOCUMENTO_EQUIVALENTE_POS',
    originType: 'COMPROBANTE_COMERCIAL',
    originId: params.comprobante.id,
    internalNumber: params.comprobante.numero,
    date: params.comprobante.fecha,
    snapshot: {
      terceroId: params.comprobante.terceroId || null,
      subtotal: String(params.subtotal ?? params.comprobante.subtotal ?? 0),
      ivaTotal: String(params.ivaTotal ?? params.comprobante.ivaTotal ?? 0),
      total: String(params.total ?? params.comprobante.total ?? 0)
    }
  });
}

async function enqueueDocumentSupportForPurchase(tenantId, purchaseId) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.comprobanteComercial.findFirst({ where: { id: purchaseId, tenantId, tipo: 'COMPRA', estado: { in: ['EMITIDO', 'PAGADO_PARCIAL', 'PAGADO_TOTAL'] } }, include: { tercero: true } });
    if (!purchase) throw new AppError(404, 'Compra emitida no encontrada', 'DIAN_PURCHASE_NOT_FOUND');
    return enqueueInTx(tx, {
      tenantId,
      documentType: 'DOCUMENTO_SOPORTE',
      originType: 'COMPROBANTE_COMERCIAL',
      originId: purchase.id,
      internalNumber: purchase.numero,
      date: purchase.fecha,
      snapshot: { terceroId: purchase.terceroId, total: String(purchase.total), proveedor: purchase.tercero?.razonSocial || purchase.tercero?.nombre }
    });
  });
}

async function listDocuments(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.state) where.state = filters.state;
  if (filters.documentType) where.documentType = filters.documentType;
  return prisma.dianDocument.findMany({ where, include: { attempts: { orderBy: { attempt: 'desc' }, take: 3 } }, orderBy: { creadoEn: 'desc' }, take: Math.min(Number(filters.limit) || 100, 500) });
}

function retryDate(attempt) {
  const minutes = RETRY_MINUTES[Math.min(Math.max(attempt - 1, 0), RETRY_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function mockTransmit(document, config) {
  if (config.providerCode === 'MOCK_PT_DOWN') {
    const error = new Error('Proveedor tecnológico simulado no disponible');
    error.retryable = true;
    throw error;
  }
  if (config.providerCode !== 'MOCK_PT') {
    const error = new Error(`Adaptador del proveedor ${config.providerCode} aún no está instalado`);
    error.retryable = true;
    throw error;
  }
  if (config.environment !== 'HABILITACION') {
    const error = new Error('MOCK_PT no puede transmitir en producción');
    error.retryable = false;
    throw error;
  }
  const digest = crypto.createHash('sha256').update(`${document.tenantId}|${document.documentType}|${document.fiscalNumber}|${document.id}`).digest('hex');
  const uniqueCodeType = document.documentType === 'NOMINA_ELECTRONICA' ? 'CUNE_TEST' : document.documentType === 'DOCUMENTO_SOPORTE' ? 'CUDS_TEST' : 'CUFE_TEST';
  return { accepted: true, requestId: `MOCK-${document.id}`, uniqueCode: digest, uniqueCodeType, response: { environment: 'HABILITACION', mock: true } };
}

async function processDocument(id) {
  const document = await prisma.dianDocument.findUnique({ where: { id } });
  if (!document || ['ACEPTADO', 'CANCELADO'].includes(document.state)) return document;
  const config = await getConfig(document.tenantId);
  if (!config) throw new AppError(409, 'Configuración DIAN no encontrada', 'DIAN_CONFIG_REQUIRED');
  const attemptNo = document.retryCount + 1;
  const started = Date.now();
  await prisma.dianDocument.update({ where: { id }, data: { state: 'ENVIANDO' } });
  try {
    const result = await mockTransmit(document, config);
    await prisma.$transaction(async (tx) => {
      await tx.dianTransmissionAttempt.create({ data: { dianDocumentId: id, attempt: attemptNo, result: 'EXITO', providerCode: config.providerCode, providerBody: result.response, durationMs: Date.now() - started } });
      await tx.dianDocument.update({
        where: { id },
        data: {
          state: 'ACEPTADO',
          retryCount: attemptNo,
          nextRetryAt: null,
          lastError: null,
          providerRequestId: result.requestId,
          uniqueCode: result.uniqueCode,
          uniqueCodeType: result.uniqueCodeType,
          providerResponse: result.response,
          sentAt: new Date(),
          acceptedAt: new Date()
        }
      });
    });
  } catch (error) {
    const retryable = error.retryable !== false;
    const nextState = retryable && config.contingencyEnabled ? 'CONTINGENCIA' : 'RECHAZADO';
    await prisma.$transaction(async (tx) => {
      await tx.dianTransmissionAttempt.create({
        data: {
          dianDocumentId: id,
          attempt: attemptNo,
          result: retryable ? 'ERROR_REINTENTABLE' : 'ERROR_DEFINITIVO',
          providerCode: config.providerCode,
          errorMessage: error.message,
          durationMs: Date.now() - started
        }
      });
      await tx.dianDocument.update({
        where: { id },
        data: {
          state: nextState,
          retryCount: attemptNo,
          nextRetryAt: retryable ? retryDate(attemptNo) : null,
          lastError: error.message,
          contingencyReason: nextState === 'CONTINGENCIA' ? error.message : null,
          rejectedAt: nextState === 'RECHAZADO' ? new Date() : null
        }
      });
    });
  }
  return prisma.dianDocument.findUnique({ where: { id }, include: { attempts: { orderBy: { attempt: 'asc' } } } });
}

async function processQueue(limit = 25) {
  const now = new Date();
  const rows = await prisma.dianDocument.findMany({
    where: {
      state: { in: ['PENDIENTE_ENVIO', 'CONTINGENCIA'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
    },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Number(limit) || 25, 100)
  });
  const results = [];
  for (const row of rows) results.push(await processDocument(row.id));
  return results;
}

async function readiness(tenantId) {
  const config = await getConfig(tenantId);
  const ranges = await listNumberingRanges(tenantId);
  return {
    configured: Boolean(config),
    config: publicConfig(config),
    numbering: ranges,
    invoiceReady: Boolean(config?.invoiceEnabled && ranges.some((r) => r.active && ['FACTURA_ELECTRONICA', 'DOCUMENTO_EQUIVALENTE_POS'].includes(r.documentType))),
    supportReady: Boolean(config?.invoiceEnabled && ranges.some((r) => r.active && r.documentType === 'DOCUMENTO_SOPORTE')),
    payrollReady: Boolean(config?.payrollEnabled && ranges.some((r) => r.active && r.documentType === 'NOMINA_ELECTRONICA')),
    realProviderAdapterInstalled: Boolean(config && config.providerCode === 'MOCK_PT' && config.environment === 'HABILITACION') ? false : false,
    note: 'El Core V1 implementa la arquitectura, cola, numeración, contingencia y adaptador de habilitación MOCK. La transmisión real requiere el contrato/API del PT seleccionado.'
  };
}

module.exports = {
  encryptJson,
  decryptJson,
  getConfig,
  getPublicConfig,
  saveConfig,
  listNumberingRanges,
  saveNumberingRange,
  reserveFiscalNumberInTx,
  enqueueInTx,
  enqueueCommercialInTx,
  enqueueDocumentSupportForPurchase,
  listDocuments,
  processDocument,
  processQueue,
  readiness
};
