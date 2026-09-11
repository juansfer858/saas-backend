'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const companyService = require('./restaurant-company-profile.service');
const receiptLayout = require('./restaurant-pos-receipt-layout.service');
const posReceipt = require('./restaurant-pos-receipt-print.service');

const SPLIT_PART_ORIGIN_TYPE = 'RESTAURANT_SPLIT_PART_RECEIPT';
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cop(value) {
  const amount = number(value);
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(amount);
}

function qty(value) {
  const amount = number(value);
  return Number.isInteger(amount) ? String(amount) : String(amount.toFixed(2)).replace(/\.00$/, '');
}

function dateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  }).format(date);
}

function endpointKey(printer) {
  const transport = String(printer?.transport || 'LAN').trim().toUpperCase();
  const host = String(printer?.host || '').trim().toLowerCase();
  return transport === 'WINDOWS' ? `WINDOWS:${host}` : `LAN:${host}:${Number(printer?.port || 9100)}`;
}

function printerDigest(printer) {
  return crypto.createHash('sha256').update(`${printer?.id || ''}|${endpointKey(printer)}`).digest('hex').slice(0, 16);
}

function stableSplitPartJobId(paymentId, printer) {
  return `restaurant-split-part:${paymentId}:printer:${printerDigest(printer)}`;
}

function intentTokenHash(tenantId, paymentId) {
  return crypto.createHash('sha256').update(`restaurant-split-part-receipt:${tenantId}:${paymentId}`).digest('hex');
}

function snapshotFromIntent(intent) {
  const timeline = Array.isArray(intent?.timeline) ? intent.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    if (event?.type === 'SPLIT_PART_RECEIPT_QUEUED' && event?.snapshot?.paymentId) return event.snapshot;
  }
  return null;
}

function splitPartReceiptLines({ company, snapshot, paperFormat = 'TERMICA_80' }) {
  const width = receiptLayout.paperColumns(paperFormat);
  const separator = '-'.repeat(width);
  const lines = [];
  const center = (value) => lines.push(...receiptLayout.centeredWrapped(value, width));
  const pair = (left, right) => lines.push(...receiptLayout.pairOrWrap(left, right, width, 2));

  center(String(company?.receiptTitle || companyService.DEFAULT_POS_RECEIPT_TITLE || 'COMPROBANTE POS').trim());
  for (const line of companyService.receiptCompanyLines(company)) center(line);
  lines.push(separator);
  center('COMPROBANTE INDIVIDUAL DE PAGO');
  pair('Venta', snapshot?.saleNumber || String(snapshot?.saleId || '').slice(0, 8).toUpperCase());
  pair('Mesa', snapshot?.tableName || 'Mesa');
  pair('Parte', snapshot?.partName || snapshot?.partKey || 'Parte');
  const when = dateTime(snapshot?.paidAt);
  if (when) center(`Pago: ${when}`);
  lines.push(separator);

  const details = Array.isArray(snapshot?.details) ? snapshot.details : [];
  if (details.length) {
    for (const detail of details) lines.push(...receiptLayout.productLines(detail, { width, qty, money: cop }));
    lines.push(separator);
  } else {
    center('Parte de la cuenta');
    lines.push(separator);
  }

  pair('TOTAL PAGADO', cop(snapshot?.saleAmount));
  pair('Medio', String(snapshot?.metodoPago || 'Pago'));
  if (snapshot?.reference) pair('Referencia', String(snapshot.reference).slice(0, 80));
  lines.push(separator);
  center('Este comprobante corresponde a una parte');
  center('de la misma venta del restaurante.');
  return lines;
}

function buildSplitPartReceiptJob({ company, snapshot, printer }) {
  const transport = String(printer.transport || 'LAN').toUpperCase();
  const paperFormat = printer.format || 'TERMICA_80';
  const columns = receiptLayout.paperColumns(paperFormat);
  return {
    id: stableSplitPartJobId(snapshot.paymentId, printer),
    station: 'CAJA',
    printer: {
      id: printer.id || null,
      name: printer.name || 'Impresora POS',
      transport,
      host: printer.host,
      port: transport === 'LAN' ? Number(printer.port || 9100) : null,
      queueName: transport === 'WINDOWS' ? printer.host : null,
      format: paperFormat
    },
    payload: {
      title: String(company?.nombreEmpresa || 'VantixGC').trim(),
      lines: splitPartReceiptLines({ company, snapshot, paperFormat }),
      footer: receiptLayout.centerLine('VantixGC · Pago individual', columns),
      copies: 1,
      cut: true,
      paperFormat,
      receiptType: 'RESTAURANT_SPLIT_PART_V20',
      receiptLayout: 'FULL_WIDTH_V2',
      columns,
      paymentId: snapshot.paymentId,
      sessionId: snapshot.sessionId,
      saleId: snapshot.saleId,
      partKey: snapshot.partKey
    }
  };
}

async function queueSplitPartReceiptIntent(tenantId, tableId, partKey, client = prisma) {
  const session = await client.restaurantTableSession.findFirst({
    where: { tenantId, tableId, splitMode: { not: null } },
    orderBy: { openedAt: 'desc' },
    include: { table: true }
  });
  if (!session) return { queued: false, reason: 'SPLIT_SESSION_NOT_FOUND' };

  const payment = await client.restaurantSessionPayment.findFirst({
    where: { tenantId, sessionId: session.id, partKey: String(partKey || '') }
  });
  if (!payment?.treasuryPaymentId) return { queued: false, reason: 'SPLIT_PAYMENT_NOT_FOUND' };

  const existing = await client.trackingLink.findFirst({
    where: { tenantId, originType: SPLIT_PART_ORIGIN_TYPE, originId: payment.treasuryPaymentId },
    select: { id: true, currentStatus: true }
  });
  if (existing) return { queued: false, reason: 'ALREADY_QUEUED', intentId: existing.id, paymentId: payment.treasuryPaymentId };

  const plan = session.splitMetadata && typeof session.splitMetadata === 'object' ? session.splitMetadata : null;
  const part = (Array.isArray(plan?.parts) ? plan.parts : []).find((row) => String(row.key) === String(partKey));
  const detailIds = Array.isArray(part?.saleDetailIds) ? part.saleDetailIds.map(String) : [];
  const sale = await client.comprobanteComercial.findFirst({
    where: { tenantId, id: session.saleId, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  });
  if (!sale) return { queued: false, reason: 'SALE_NOT_FOUND' };

  const details = detailIds.length
    ? (sale.detalles || []).filter((detail) => detailIds.includes(String(detail.id))).map((detail) => ({
      id: detail.id,
      descripcion: detail.descripcion,
      cantidad: String(detail.cantidad),
      precioUnitario: String(detail.precioUnitario),
      totalLinea: String(detail.totalLinea)
    }))
    : [];

  const snapshot = {
    sessionId: session.id,
    tableId: session.tableId,
    tableName: session.table?.name || session.table?.code || 'Mesa',
    saleId: sale.id,
    saleNumber: sale.numero || null,
    partKey: payment.partKey,
    partName: part?.name || `Parte ${payment.partKey}`,
    saleAmount: String(payment.saleAmount),
    metodoPago: payment.metodoPago,
    reference: payment.reference || null,
    paidAt: payment.paidAt?.toISOString?.() || payment.paidAt || new Date().toISOString(),
    paymentId: payment.treasuryPaymentId,
    details
  };
  const now = new Date();
  const data = {
    tokenHash: intentTokenHash(tenantId, payment.treasuryPaymentId),
    tokenCiphertext: `SPLIT_PART_RECEIPT:${payment.treasuryPaymentId}`,
    tokenHint: String(part?.name || payment.partKey).slice(-6),
    publicReference: `${sale.numero || sale.id}-${payment.partKey}`,
    currentStatus: 'PENDING',
    timeline: [{ type: 'SPLIT_PART_RECEIPT_QUEUED', at: now.toISOString(), snapshot }],
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    completedAt: null,
    active: true,
    lastNotificationAt: now
  };
  const intent = await client.trackingLink.upsert({
    where: { tenantId_originType_originId: { tenantId, originType: SPLIT_PART_ORIGIN_TYPE, originId: payment.treasuryPaymentId } },
    create: { tenantId, originType: SPLIT_PART_ORIGIN_TYPE, originId: payment.treasuryPaymentId, ...data },
    update: data
  });
  return { queued: true, intentId: intent.id, paymentId: payment.treasuryPaymentId, snapshot };
}

async function buildPendingSplitPartReceiptJobs(tenantId) {
  const now = new Date();
  const [company, printers, intents] = await Promise.all([
    companyService.getCompanyProfile(tenantId),
    prisma.printerEndpoint.findMany({ where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } }, orderBy: { name: 'asc' } }),
    prisma.trackingLink.findMany({
      where: {
        tenantId,
        originType: SPLIT_PART_ORIGIN_TYPE,
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
    return { jobs: [], routing: selected.routing, receiptCount: 0, splitPartReceiptCount: 0, printerCount: selected.printers.length };
  }

  const jobs = [];
  let splitPartReceiptCount = 0;
  for (const intent of intents) {
    const snapshot = snapshotFromIntent(intent);
    if (!snapshot) continue;
    splitPartReceiptCount += 1;
    for (const printer of selected.printers) jobs.push(buildSplitPartReceiptJob({ company, snapshot, printer }));
  }

  return {
    jobs,
    routing: selected.routing,
    receiptCount: splitPartReceiptCount,
    splitPartReceiptCount,
    printerCount: selected.printers.length
  };
}

module.exports = {
  SPLIT_PART_ORIGIN_TYPE,
  INTENT_TTL_MS,
  stableSplitPartJobId,
  intentTokenHash,
  snapshotFromIntent,
  splitPartReceiptLines,
  buildSplitPartReceiptJob,
  queueSplitPartReceiptIntent,
  buildPendingSplitPartReceiptJobs
};
