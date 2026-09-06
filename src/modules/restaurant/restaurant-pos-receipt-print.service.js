'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');

const POS_ROLE = 'CAJA';
const DOCUMENT_ROLE = 'DOCUMENTOS';
const DEFAULT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

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

function receiptLines({ sale, session, table }) {
  const lines = [];
  lines.push('TIRILLA POS');
  lines.push(`Venta: ${sale?.numero || String(sale?.id || '').slice(0, 8).toUpperCase()}`);
  lines.push(`Mesa: ${table?.name || table?.code || 'Mesa'}`);
  const when = dateTime(sale?.emitidoEn || session?.closedAt || sale?.fecha);
  if (when) lines.push(`Fecha: ${when}`);
  lines.push('--------------------------------');

  for (const detail of Array.isArray(sale?.detalles) ? sale.detalles : []) {
    const description = String(detail?.descripcion || 'Producto').trim();
    lines.push(`${qty(detail?.cantidad)} x ${description}`);
    lines.push(`  ${cop(detail?.precioUnitario)} c/u  ${cop(detail?.totalLinea)}`);
  }

  lines.push('--------------------------------');
  lines.push(`Subtotal: ${cop(sale?.subtotal)}`);
  if (number(sale?.descuentoTotal) > 0) lines.push(`Descuento: ${cop(sale.descuentoTotal)}`);
  if (number(sale?.ivaTotal) > 0) lines.push(`IVA: ${cop(sale.ivaTotal)}`);
  if (number(sale?.impoconsumoTotal) > 0) lines.push(`Impoconsumo: ${cop(sale.impoconsumoTotal)}`);
  const tip = number(session?.tipAmount);
  if (tip > 0) lines.push(`Propina: ${cop(tip)}`);
  lines.push(`TOTAL: ${cop(number(sale?.total) + tip)}`);
  const payment = String(session?.paymentMethodLabel || session?.paymentMethodKind || sale?.formaPago || '').trim();
  if (payment) lines.push(`Pago: ${payment}`);
  if (session?.paymentReference) lines.push(`Ref: ${String(session.paymentReference).slice(0, 80)}`);
  return lines;
}

function buildReceiptJob({ tenantName, sale, session, table, printer }) {
  const transport = String(printer.transport || 'LAN').toUpperCase();
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
      format: printer.format || 'TERMICA_80'
    },
    payload: {
      title: String(tenantName || 'VantixGC').trim(),
      lines: receiptLines({ sale, session, table }),
      footer: 'Gracias por su compra',
      copies: 1,
      cut: true,
      paperFormat: printer.format || 'TERMICA_80',
      receiptType: 'RESTAURANT_POS_V1',
      saleId: sale.id,
      sessionId: session.id
    }
  };
}

async function buildRecentReceiptJobs(tenantId, options = {}) {
  const lookbackMs = Math.max(60_000, Number(options.lookbackMs || DEFAULT_LOOKBACK_MS));
  const since = new Date(Date.now() - lookbackMs);
  const [tenant, printers, sessions] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { nombreEmpresa: true } }),
    prisma.printerEndpoint.findMany({ where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } }, orderBy: { name: 'asc' } }),
    prisma.restaurantTableSession.findMany({
      where: { tenantId, state: 'CERRADA', closedAt: { gte: since } },
      include: { table: true },
      orderBy: { closedAt: 'desc' },
      take: 60
    })
  ]);
  const selected = selectReceiptPrinters(printers);
  if (!selected.printers.length || !sessions.length) {
    return { jobs: [], routing: selected.routing, receiptCount: 0, printerCount: selected.printers.length };
  }

  const saleIds = [...new Set(sessions.map((session) => session.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const jobs = [];
  let receiptCount = 0;
  for (const session of sessions) {
    const sale = saleById.get(session.saleId);
    if (!sale || !Array.isArray(sale.detalles) || !sale.detalles.length || number(sale.saldo) > 0) continue;
    receiptCount += 1;
    for (const printer of selected.printers) {
      jobs.push(buildReceiptJob({ tenantName: tenant?.nombreEmpresa || 'VantixGC', sale, session, table: session.table, printer }));
    }
  }
  return { jobs, routing: selected.routing, receiptCount, printerCount: selected.printers.length };
}

module.exports = {
  POS_ROLE,
  DOCUMENT_ROLE,
  DEFAULT_LOOKBACK_MS,
  endpointKey,
  stableReceiptJobId,
  uniquePhysicalPrinters,
  selectReceiptPrinters,
  cop,
  qty,
  receiptLines,
  buildReceiptJob,
  buildRecentReceiptJobs
};
