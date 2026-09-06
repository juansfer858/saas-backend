'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const companyService = require('./restaurant-company-profile.service');
const receiptLayout = require('./restaurant-pos-receipt-layout.service');

const POS_ROLE = 'CAJA';
const DOCUMENT_ROLE = 'DOCUMENTOS';
const ORIGIN_TYPE = 'RESTAURANT_POS_RECEIPT';
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function endpointKey(printer) {
  const transport = String(printer?.transport || 'LAN').trim().toUpperCase();
  const host = String(printer?.host || '').trim().toLowerCase();
  return transport === 'WINDOWS' ? `WINDOWS:${host}` : `LAN:${host}:${Number(printer?.port || 9100)}`;
}

function stableReceiptJobId(saleId, printer) {
  const digest = crypto.createHash('sha256').update(`${printer?.id || ''}|${endpointKey(printer)}`).digest('hex').slice(0, 16);
  return `restaurant-pos:${saleId}:printer:${digest}`;
}

function uniquePhysicalPrinters(printers) {
  const seen = new Set();
  return (Array.isArray(printers) ? printers : []).filter((printer) => {
    const transport = String(printer?.transport || '').toUpperCase();
    if (!['LAN', 'WINDOWS'].includes(transport) || printer?.active === false || !String(printer?.host || '').trim()) return false;
    const key = endpointKey(printer);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectReceiptPrinters(printers) {
  const physical = uniquePhysicalPrinters(printers);
  const cash = physical.filter((printer) => String(printer.role || '').trim().toUpperCase() === POS_ROLE);
  if (cash.length) return { printers: cash, routing: 'CAJA' };
  const documents = physical.filter((printer) => String(printer.role || '').trim().toUpperCase() === DOCUMENT_ROLE);
  if (documents.length) return { printers: documents, routing: 'DOCUMENTOS' };
  if (physical.length === 1) return { printers: physical, routing: 'SINGLE_PHYSICAL_FALLBACK' };
  return { printers: [], routing: physical.length ? 'AMBIGUOUS_PHYSICAL_PRINTERS' : 'NO_PHYSICAL_PRINTER' };
}

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

function receiptLines({ company, sale, session, table, paperFormat = 'TERMICA_80' }) {
  return receiptLayout.receiptLinesFullWidth({
    company,
    sale,
    session,
    table,
    paperFormat,
    companyLines: companyService.receiptCompanyLines,
    money: cop,
    qty,
    dateTime,
    number,
    defaultTitle: companyService.DEFAULT_POS_RECEIPT_TITLE
  });
}

function buildReceiptJob({ company, sale, session, table, printer }) {
  const transport = String(printer.transport || 'LAN').toUpperCase();
  const paperFormat = printer.format || 'TERMICA_80';
  const columns = receiptLayout.paperColumns(paperFormat);
  return {
    id: stableReceiptJobId(sale.id, printer),
    station: POS_ROLE,
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
      lines: receiptLines({ company, sale, session, table, paperFormat }),
      footer: receiptLayout.centerLine('Gracias por su compra', columns),
      copies: 1,
      cut: true,
      paperFormat,
      receiptType: 'RESTAURANT_POS_V1',
      receiptLayout: 'FULL_WIDTH_V2',
      columns,
      documentTitle: String(company?.receiptTitle || companyService.DEFAULT_POS_RECEIPT_TITLE).trim(),
      saleId: sale.id,
      sessionId: session.id
    }
  };
}

function intentTokenHash(tenantId, sessionId) {
  return crypto.createHash('sha256').update(`restaurant-pos-receipt:${tenantId}:${sessionId}`).digest('hex');
}

async function queueReceiptIntent(tenantId, sessionId, client = prisma) {
  const session = await client.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId, state: 'CERRADA' },
    select: { id: true, saleId: true, closedAt: true }
  });
  if (!session) return { queued: false, reason: 'SESSION_NOT_CLOSED' };
  const sale = await client.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    select: { id: true, numero: true, saldo: true }
  });
  if (!sale || number(sale.saldo) > 0) return { queued: false, reason: 'SALE_NOT_PAID' };
  const now = new Date();
  const data = {
    tokenHash: intentTokenHash(tenantId, session.id),
    tokenCiphertext: `POS_RECEIPT:${session.id}`,
    tokenHint: String(sale.numero || sale.id).slice(-6),
    publicReference: String(sale.numero || sale.id),
    currentStatus: 'PENDING',
    timeline: [{ type: 'POS_RECEIPT_QUEUED', at: now.toISOString(), sessionId: session.id, saleId: sale.id }],
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    completedAt: null,
    active: true,
    lastNotificationAt: now
  };
  const intent = await client.trackingLink.upsert({
    where: { tenantId_originType_originId: { tenantId, originType: ORIGIN_TYPE, originId: session.id } },
    create: { tenantId, originType: ORIGIN_TYPE, originId: session.id, ...data },
    update: data
  });
  return { queued: true, intentId: intent.id, sessionId: session.id, saleId: sale.id };
}

async function queueReceiptForTableIfClosed(tenantId, tableId) {
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const session = await prisma.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: 'CERRADA', closedAt: { gte: since } },
    select: { id: true },
    orderBy: { closedAt: 'desc' }
  });
  if (!session) return { queued: false, reason: 'PAYMENT_NOT_FINAL' };
  return queueReceiptIntent(tenantId, session.id);
}

async function buildPendingReceiptJobs(tenantId) {
  const now = new Date();
  const [company, printers, intents] = await Promise.all([
    companyService.getCompanyProfile(tenantId),
    prisma.printerEndpoint.findMany({ where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } }, orderBy: { name: 'asc' } }),
    prisma.trackingLink.findMany({
      where: { tenantId, originType: ORIGIN_TYPE, active: true, currentStatus: 'PENDING', expiresAt: { gt: now } },
      orderBy: { creadoEn: 'asc' },
      take: 60
    })
  ]);
  const selected = selectReceiptPrinters(printers);
  if (!selected.printers.length || !intents.length) {
    return { jobs: [], routing: selected.routing, receiptCount: 0, printerCount: selected.printers.length };
  }

  const sessionIds = [...new Set(intents.map((intent) => intent.originId).filter(Boolean))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: sessionIds }, state: 'CERRADA' },
    include: { table: true }
  }) : [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const saleIds = [...new Set(sessions.map((session) => session.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const jobs = [];
  let receiptCount = 0;
  for (const intent of intents) {
    const session = sessionById.get(intent.originId);
    const sale = session ? saleById.get(session.saleId) : null;
    if (!session || !sale || !sale.detalles?.length || number(sale.saldo) > 0) continue;
    receiptCount += 1;
    for (const printer of selected.printers) {
      jobs.push(buildReceiptJob({ company, sale, session, table: session.table, printer }));
    }
  }
  return { jobs, routing: selected.routing, receiptCount, printerCount: selected.printers.length };
}

module.exports = {
  POS_ROLE,
  DOCUMENT_ROLE,
  ORIGIN_TYPE,
  INTENT_TTL_MS,
  endpointKey,
  stableReceiptJobId,
  uniquePhysicalPrinters,
  selectReceiptPrinters,
  number,
  cop,
  qty,
  dateTime,
  paperColumns: receiptLayout.paperColumns,
  receiptLines,
  buildReceiptJob,
  intentTokenHash,
  queueReceiptIntent,
  queueReceiptForTableIfClosed,
  buildPendingReceiptJobs,
  buildRecentReceiptJobs: buildPendingReceiptJobs
};
