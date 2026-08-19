const { prisma } = require('../../../config/prisma');
const dian = require('./dian.service');
const hka = require('./providers/the-factory-hka.provider');

const RETRY_MINUTES = [1, 5, 15, 60, 180, 720];

function retryDate(attempt) {
  const minutes = RETRY_MINUTES[Math.min(Math.max(attempt - 1, 0), RETRY_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function originForDocument(document) {
  if (document.originType !== 'COMPROBANTE_COMERCIAL') return null;
  return prisma.comprobanteComercial.findFirst({
    where: { id: document.originId, tenantId: document.tenantId },
    include: {
      tercero: true,
      detalles: { include: { producto: true } }
    }
  });
}

async function processRealProvider(document, config) {
  const attemptNo = document.retryCount + 1;
  const started = Date.now();
  const credentials = dian.decryptJson(config.credentialCiphertext);
  const origin = await originForDocument(document);
  await prisma.dianDocument.update({ where: { id: document.id }, data: { state: 'ENVIANDO' } });

  try {
    const result = await hka.transmit({ document, config, credentials, origin });
    await prisma.$transaction(async (tx) => {
      await tx.dianTransmissionAttempt.create({
        data: {
          dianDocumentId: document.id,
          attempt: attemptNo,
          result: 'EXITO',
          httpStatus: 200,
          providerCode: config.providerCode,
          providerBody: result.response,
          durationMs: Date.now() - started
        }
      });
      await tx.dianDocument.update({
        where: { id: document.id },
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
          acceptedAt: new Date(),
          rejectedAt: null,
          contingencyReason: null
        }
      });
    });
  } catch (error) {
    const retryable = error.retryable !== false;
    const state = retryable && config.contingencyEnabled ? 'CONTINGENCIA' : 'RECHAZADO';
    await prisma.$transaction(async (tx) => {
      await tx.dianTransmissionAttempt.create({
        data: {
          dianDocumentId: document.id,
          attempt: attemptNo,
          result: retryable ? 'ERROR_REINTENTABLE' : 'ERROR_DEFINITIVO',
          httpStatus: error.httpStatus || null,
          providerCode: config.providerCode,
          providerBody: error.providerResponse || null,
          errorMessage: error.message,
          durationMs: Date.now() - started
        }
      });
      await tx.dianDocument.update({
        where: { id: document.id },
        data: {
          state,
          retryCount: attemptNo,
          nextRetryAt: retryable ? retryDate(attemptNo) : null,
          lastError: error.message,
          contingencyReason: state === 'CONTINGENCIA' ? error.message : null,
          rejectedAt: state === 'RECHAZADO' ? new Date() : null
        }
      });
    });
  }

  return prisma.dianDocument.findUnique({ where: { id: document.id }, include: { attempts: { orderBy: { attempt: 'asc' } } } });
}

async function processDocument(id) {
  const document = await prisma.dianDocument.findUnique({ where: { id } });
  if (!document || ['ACEPTADO', 'CANCELADO'].includes(document.state)) return document;
  const config = await dian.getConfig(document.tenantId);
  if (!config) return dian.processDocument(id);
  if (config.providerCode === hka.PROVIDER_CODE) return processRealProvider(document, config);
  return dian.processDocument(id);
}

async function processQueue(limit = 25) {
  const rows = await prisma.dianDocument.findMany({
    where: {
      state: { in: ['PENDIENTE_ENVIO', 'CONTINGENCIA'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }]
    },
    orderBy: { creadoEn: 'asc' },
    take: Math.min(Number(limit) || 25, 100)
  });
  const results = [];
  for (const row of rows) results.push(await processDocument(row.id));
  return results;
}

async function readiness(tenantId) {
  const base = await dian.readiness(tenantId);
  const config = await dian.getConfig(tenantId);
  if (!config || config.providerCode !== hka.PROVIDER_CODE) {
    return { ...base, providerAdapter: { installed: false, configured: false, providerCode: config?.providerCode || null } };
  }
  let credentials = null;
  try { credentials = dian.decryptJson(config.credentialCiphertext); } catch {}
  const providerAdapter = hka.readiness(config, credentials);
  return {
    ...base,
    realProviderAdapterInstalled: providerAdapter.installed,
    providerAdapter,
    habilitacionAccepted: Boolean(config.habilitacionChecklist?.dianAccepted || config.habilitacionChecklist?.habilitado),
    note: providerAdapter.configured
      ? 'Adaptador HTTP real The Factory HKA instalado. La habilitación efectiva exige credenciales, plantilla fiscal validada y set de pruebas aceptado por DIAN/PT.'
      : providerAdapter.note
  };
}

module.exports = { processDocument, processQueue, readiness, originForDocument };
