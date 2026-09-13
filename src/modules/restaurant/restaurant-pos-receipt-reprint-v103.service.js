'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const posReceipt = require('./restaurant-pos-receipt-print.service');

const VERSION = '103.0.0';
const REPRINT_ORIGIN_TYPE = 'RESTAURANT_POS_RECEIPT_REPRINT';
const REPRINT_EVENT = 'POS_RECEIPT_REPRINT_QUEUED';
const INSTALL_FLAG = Symbol.for('vantixgc.restaurant.pos.receipt.reprint.v103');
const TTL_MS = Number(posReceipt.INTENT_TTL_MS || (24 * 60 * 60 * 1000));

function printerDigest(printer) {
  return crypto.createHash('sha256')
    .update(`${printer?.id || ''}|${posReceipt.endpointKey(printer)}`)
    .digest('hex')
    .slice(0, 16);
}

function stableReprintJobId(saleId, attemptId, printer) {
  return `restaurant-pos:${saleId}:reprint:${attemptId}:printer:${printerDigest(printer)}`;
}

function reprintTokenHash(tenantId, saleId, attemptId) {
  return crypto.createHash('sha256')
    .update(`restaurant-pos-reprint:${tenantId}:${saleId}:${attemptId}`)
    .digest('hex');
}

function reprintMeta(intent) {
  const timeline = Array.isArray(intent?.timeline) ? intent.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    if (event?.type === REPRINT_EVENT && event?.attemptId && event?.saleId && event?.sessionId) return event;
  }
  return null;
}

async function eligibility(tenantId, saleId, client = prisma) {
  const sale = await client.comprobanteComercial.findFirst({
    where: {
      id: saleId,
      tenantId,
      tipo: 'FACTURA_VENTA',
      estado: { not: 'ANULADO' }
    },
    select: { id: true, numero: true, saldo: true, estado: true }
  });
  if (!sale) return { eligible: false, reason: 'SALE_NOT_FOUND' };
  if (posReceipt.number(sale.saldo) > 0) {
    return { eligible: false, reason: 'SALE_NOT_PAID', saleId: sale.id, saleNumber: sale.numero || null };
  }

  const session = await client.restaurantTableSession.findFirst({
    where: { tenantId, saleId: sale.id, state: 'CERRADA' },
    select: { id: true, saleId: true, closedAt: true },
    orderBy: { closedAt: 'desc' }
  });
  if (!session) {
    return { eligible: false, reason: 'NOT_RESTAURANT_POS_SALE', saleId: sale.id, saleNumber: sale.numero || null };
  }

  const printers = await client.printerEndpoint.findMany({
    where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } },
    orderBy: { name: 'asc' }
  });
  const selected = posReceipt.selectReceiptPrinters(printers);
  if (!selected.printers.length) {
    return {
      eligible: false,
      reason: selected.routing || 'NO_PHYSICAL_PRINTER',
      saleId: sale.id,
      saleNumber: sale.numero || null,
      sessionId: session.id,
      routing: selected.routing || null,
      printerCount: 0
    };
  }

  return {
    eligible: true,
    reason: null,
    saleId: sale.id,
    saleNumber: sale.numero || null,
    sessionId: session.id,
    routing: selected.routing,
    printerCount: selected.printers.length
  };
}

async function queueReceiptReprint(tenantId, user, saleId) {
  return prisma.$transaction(async (tx) => {
    const check = await eligibility(tenantId, saleId, tx);
    if (!check.eligible) return { queued: false, ...check };

    const attemptId = crypto.randomUUID();
    const now = new Date();
    const event = {
      type: REPRINT_EVENT,
      at: now.toISOString(),
      attemptId,
      saleId: check.saleId,
      sessionId: check.sessionId,
      requestedByUserId: user?.id || null,
      version: VERSION
    };

    const intent = await tx.trackingLink.create({
      data: {
        tenantId,
        originType: REPRINT_ORIGIN_TYPE,
        originId: attemptId,
        tokenHash: reprintTokenHash(tenantId, check.saleId, attemptId),
        tokenCiphertext: `POS_RECEIPT_REPRINT:${check.saleId}:${attemptId}`,
        tokenHint: String(check.saleNumber || check.saleId).slice(-6),
        publicReference: String(check.saleNumber || check.saleId),
        currentStatus: 'PENDING',
        timeline: [event],
        expiresAt: new Date(now.getTime() + TTL_MS),
        completedAt: null,
        active: true,
        lastNotificationAt: now
      }
    });

    await tx.auditoriaContable.create({
      data: {
        tenantId,
        userId: user.id,
        entidad: 'RESTAURANT_POS_RECEIPT',
        entidadId: check.saleId,
        accion: 'REPRINT_POS_RECEIPT_QUEUED',
        metadata: {
          marker: 'VANTIX_RESTAURANT_POS_RECEIPT_REPRINT_V103',
          version: VERSION,
          attemptId,
          intentId: intent.id,
          saleId: check.saleId,
          saleNumber: check.saleNumber,
          sessionId: check.sessionId,
          routing: check.routing,
          printerCount: check.printerCount,
          printOnly: true,
          financialMutation: false
        }
      }
    });

    return {
      queued: true,
      eligible: true,
      attemptId,
      intentId: intent.id,
      saleId: check.saleId,
      saleNumber: check.saleNumber,
      sessionId: check.sessionId,
      routing: check.routing,
      printerCount: check.printerCount,
      printOnly: true
    };
  });
}

async function buildRecentReprintJobs(tenantId) {
  const now = new Date();
  const [company, printers, intents] = await Promise.all([
    require('./restaurant-company-profile.service').getCompanyProfile(tenantId),
    prisma.printerEndpoint.findMany({
      where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } },
      orderBy: { name: 'asc' }
    }),
    prisma.trackingLink.findMany({
      where: {
        tenantId,
        originType: REPRINT_ORIGIN_TYPE,
        active: true,
        currentStatus: 'PENDING',
        expiresAt: { gt: now }
      },
      orderBy: { creadoEn: 'asc' },
      take: 80
    })
  ]);

  const selected = posReceipt.selectReceiptPrinters(printers);
  if (!selected.printers.length || !intents.length) {
    return { jobs: [], routing: selected.routing, receiptCount: 0, printerCount: selected.printers.length };
  }

  const entries = intents.map((intent) => ({ intent, meta: reprintMeta(intent) })).filter((row) => row.meta);
  const sessionIds = [...new Set(entries.map((row) => row.meta.sessionId).filter(Boolean))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: sessionIds }, state: 'CERRADA' },
    include: { table: true }
  }) : [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const saleIds = [...new Set(entries.map((row) => row.meta.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const jobs = [];
  let receiptCount = 0;

  for (const entry of entries) {
    const { meta } = entry;
    const session = sessionById.get(meta.sessionId);
    const sale = saleById.get(meta.saleId);
    if (!session || !sale || session.saleId !== sale.id || !sale.detalles?.length || posReceipt.number(sale.saldo) > 0) continue;
    receiptCount += 1;
    for (const printer of selected.printers) {
      const job = posReceipt.buildReceiptJob({ company, sale, session, table: session.table, printer });
      jobs.push({
        ...job,
        id: stableReprintJobId(sale.id, meta.attemptId, printer),
        payload: {
          ...job.payload,
          reprint: true,
          reprintAttemptId: meta.attemptId,
          reprintRequestedAt: meta.at || null
        }
      });
    }
  }

  return { jobs, routing: selected.routing, receiptCount, printerCount: selected.printers.length };
}

function install() {
  if (posReceipt[INSTALL_FLAG]) return posReceipt;
  const originalBuildRecentReceiptJobs = posReceipt.buildRecentReceiptJobs.bind(posReceipt);
  posReceipt.buildRecentReceiptJobs = async function buildRecentReceiptJobsWithReprints(tenantId) {
    const [base, reprints] = await Promise.all([
      originalBuildRecentReceiptJobs(tenantId),
      buildRecentReprintJobs(tenantId)
    ]);
    return {
      ...base,
      jobs: [...(base.jobs || []), ...(reprints.jobs || [])],
      receiptCount: Number(base.receiptCount || 0) + Number(reprints.receiptCount || 0),
      reprintReceiptCount: Number(reprints.receiptCount || 0),
      reprintJobCount: (reprints.jobs || []).length
    };
  };
  Object.defineProperty(posReceipt, INSTALL_FLAG, { value: true });
  return posReceipt;
}

install();

module.exports = {
  VERSION,
  REPRINT_ORIGIN_TYPE,
  REPRINT_EVENT,
  INSTALL_FLAG,
  printerDigest,
  stableReprintJobId,
  reprintTokenHash,
  reprintMeta,
  eligibility,
  queueReceiptReprint,
  buildRecentReprintJobs,
  install
};
