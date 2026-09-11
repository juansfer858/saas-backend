'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { decimal, money: decimalMoney } = require('../../utils/decimal');
const companyService = require('./restaurant-company-profile.service');
const receiptLayout = require('./restaurant-pos-receipt-layout.service');

const POS_ROLE = 'CAJA';
const DOCUMENT_ROLE = 'DOCUMENTOS';
const ORIGIN_TYPE = 'RESTAURANT_POS_RECEIPT';
const CASH_SHIFT_ORIGIN_TYPE = 'RESTAURANT_CASH_SHIFT_CLOSE_RECEIPT';
const C86_MARKER = 'VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86';
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const CASH_CLOSE_COLUMNS_80 = 48;
const CASH_CLOSE_COLUMNS_58 = 32;

function endpointKey(printer) {
  const transport = String(printer?.transport || 'LAN').trim().toUpperCase();
  const host = String(printer?.host || '').trim().toLowerCase();
  return transport === 'WINDOWS' ? `WINDOWS:${host}` : `LAN:${host}:${Number(printer?.port || 9100)}`;
}

function printerDigest(printer) {
  return crypto.createHash('sha256').update(`${printer?.id || ''}|${endpointKey(printer)}`).digest('hex').slice(0, 16);
}

function stableReceiptJobId(saleId, printer) {
  return `restaurant-pos:${saleId}:printer:${printerDigest(printer)}`;
}

function stableCashCloseJobId(shiftId, printer, printRequestId = null) {
  const request = printRequestId ? `:request:${String(printRequestId).slice(0, 36)}` : '';
  return `restaurant-cash-close:${shiftId}:printer:${printerDigest(printer)}${request}`;
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

function moneyString(value) {
  return decimalMoney(value || 0).toString();
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

function timeOnly(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
}

function cashCloseColumns(format) {
  const normalized = String(format || 'TERMICA_80').trim().toUpperCase();
  return normalized.includes('58') ? CASH_CLOSE_COLUMNS_58 : CASH_CLOSE_COLUMNS_80;
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

function paymentKind(session, sale) {
  const kind = String(session?.paymentMethodKind || '').trim().toUpperCase();
  if (kind) return kind;
  const forma = String(sale?.formaPago || '').trim().toUpperCase();
  if (forma === 'EFECTIVO') return 'EFECTIVO';
  if (forma === 'CREDITO') return 'CREDITO';
  if (forma === 'BANCO') return 'BANCO';
  return 'OTRO';
}

async function buildCashCloseSnapshot(tenantId, shiftId, client = prisma) {
  const shift = await client.aperturaCierreCaja.findFirst({
    where: { id: shiftId, tenantId, estado: 'CERRADA' },
    include: {
      cajaBanco: { select: { id: true, nombre: true } },
      user: { select: { id: true, nombre: true, email: true } }
    }
  });
  if (!shift) return null;

  const sessions = await client.restaurantTableSession.findMany({
    where: { tenantId, cashShiftId: shift.id, state: 'CERRADA' },
    include: { table: true },
    orderBy: { closedAt: 'asc' }
  });
  const saleIds = [...new Set(sessions.map((row) => row.saleId).filter(Boolean))];
  const sales = saleIds.length ? await client.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    select: { id: true, numero: true, total: true, formaPago: true }
  }) : [];
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));

  let restaurantTotal = decimal(0);
  let cashSales = decimal(0);
  let transferSales = decimal(0);
  let cardSales = decimal(0);
  let bankOtherSales = decimal(0);
  let creditSales = decimal(0);
  const tables = [];

  for (const session of sessions) {
    const sale = saleById.get(session.saleId);
    if (!sale) continue;
    const saleTotal = decimal(sale.total || 0);
    const tipAmount = decimal(session.tipAmount || 0);
    const total = saleTotal.plus(tipAmount);
    restaurantTotal = restaurantTotal.plus(total);
    const kind = paymentKind(session, sale);
    if (kind === 'EFECTIVO') cashSales = cashSales.plus(total);
    else if (kind === 'TRANSFERENCIA') transferSales = transferSales.plus(total);
    else if (kind === 'TARJETA') cardSales = cardSales.plus(total);
    else if (kind === 'CREDITO') creditSales = creditSales.plus(total);
    else if (kind === 'BANCO') bankOtherSales = bankOtherSales.plus(total);

    tables.push({
      sessionId: session.id,
      table: session.table?.name || session.table?.code || 'Mesa',
      saleNumber: sale.numero || null,
      saleTotal: moneyString(saleTotal),
      tipAmount: moneyString(tipAmount),
      total: moneyString(total),
      paymentMethodKind: kind,
      paymentMethodLabel: session.paymentMethodLabel || null,
      paymentReference: session.paymentReference || null
    });
  }

  return {
    shift: {
      id: shift.id,
      cajaBancoId: shift.cajaBancoId,
      cajaNombre: shift.cajaBanco?.nombre || 'Caja',
      userId: shift.userId,
      cajero: shift.user?.nombre || shift.user?.email || 'Cajero',
      saldoInicial: moneyString(shift.saldoInicial),
      ingresosEfectivo: moneyString(shift.ingresosEfectivo),
      ingresosVoucher: moneyString(shift.ingresosVoucher),
      egresosEfectivo: moneyString(shift.egresosEfectivo),
      saldoEsperado: moneyString(shift.saldoEsperado),
      saldoFinal: shift.saldoFinal == null ? null : moneyString(shift.saldoFinal),
      descuadre: shift.descuadre == null ? null : moneyString(shift.descuadre),
      abiertoEn: shift.abiertoEn?.toISOString?.() || shift.abiertoEn || null,
      cerradoEn: shift.cerradoEn?.toISOString?.() || shift.cerradoEn || null
    },
    restaurantClosedTablesTotal: moneyString(restaurantTotal),
    systemCashExpected: moneyString(decimal(shift.saldoInicial || 0).plus(shift.ingresosEfectivo || 0).minus(shift.egresosEfectivo || 0)),
    restaurantCashRecorded: moneyString(shift.ingresosEfectivo),
    paymentBreakdown: {
      cashSales: moneyString(cashSales),
      transferSales: moneyString(transferSales),
      cardSales: moneyString(cardSales),
      bankOtherSales: moneyString(bankOtherSales),
      electronicSales: moneyString(transferSales.plus(cardSales).plus(bankOtherSales)),
      creditSales: moneyString(creditSales),
      exactMethodBreakdown: true
    },
    tables
  };
}

function legacyCashCloseReceiptLines({ company, snapshot, paperFormat = 'TERMICA_80' }) {
  const width = cashCloseColumns(paperFormat);
  const separator = '-'.repeat(width);
  const lines = [];
  const pair = (left, right) => lines.push(...receiptLayout.pairOrWrap(left, right, width, 2));
  const center = (value) => lines.push(...receiptLayout.centeredWrapped(value, width));

  center(company?.nombreEmpresa || 'Restaurante');
  for (const line of companyService.receiptCompanyLines(company)) center(line);
  lines.push(separator);
  center('CIERRE DE TURNO / CAJA');
  pair('Caja', snapshot?.shift?.cajaNombre || 'Caja');
  pair('Cajero', snapshot?.shift?.cajero || 'Cajero');
  const opened = dateTime(snapshot?.shift?.abiertoEn);
  const closed = dateTime(snapshot?.shift?.cerradoEn);
  if (opened) center(`Apertura: ${opened}`);
  if (closed) center(`Cierre: ${closed}`);
  lines.push(separator);
  pair('Ventas cerradas', String(snapshot?.tables?.length || 0));
  pair('Total ventas + propinas', cop(snapshot?.restaurantClosedTablesTotal));
  lines.push(separator);
  center('VENTAS POR MEDIO DE PAGO');
  pair('Efectivo', cop(snapshot?.paymentBreakdown?.cashSales));
  pair('Transferencias / QR', cop(snapshot?.paymentBreakdown?.transferSales));
  pair('Tarjetas', cop(snapshot?.paymentBreakdown?.cardSales));
  pair('Crédito / cartera', cop(snapshot?.paymentBreakdown?.creditSales));
  if (number(snapshot?.paymentBreakdown?.bankOtherSales) !== 0) pair('Banco / otros', cop(snapshot.paymentBreakdown.bankOtherSales));
  lines.push(separator);
  center('ARQUEO DE CAJA');
  pair('Fondo inicial', cop(snapshot?.shift?.saldoInicial));
  pair('Ingresos efectivo', cop(snapshot?.shift?.ingresosEfectivo));
  pair('Ingresos voucher', cop(snapshot?.shift?.ingresosVoucher));
  pair('Egresos efectivo', cop(snapshot?.shift?.egresosEfectivo));
  pair('Efectivo esperado', cop(snapshot?.systemCashExpected));
  pair('Conteo final', cop(snapshot?.shift?.saldoFinal));
  pair('DESCUADRE', cop(snapshot?.shift?.descuadre));
  if (Array.isArray(snapshot?.tables) && snapshot.tables.length) {
    lines.push(separator);
    center('DETALLE DE VENTAS');
    for (const row of snapshot.tables) {
      pair(`${row.table || 'Mesa'} · ${row.saleNumber || 'S/N'}`, cop(row.total));
      const method = String(row.paymentMethodLabel || row.paymentMethodKind || '').trim();
      if (method) lines.push(...receiptLayout.wrapText(`  ${method}`, width));
    }
  }
  lines.push(separator);
  center(`Turno: ${String(snapshot?.shift?.id || '').slice(0, 12).toUpperCase()}`);
  center('FIN DEL CIERRE');
  return lines;
}

function c86CashCloseReceiptLines({ company, snapshot, paperFormat = 'TERMICA_80' }) {
  const width = cashCloseColumns(paperFormat);
  const separator = '-'.repeat(width);
  const lines = [];
  const pair = (left, right) => lines.push(...receiptLayout.pairOrWrap(left, right, width, 2));
  const center = (value) => lines.push(...receiptLayout.centeredWrapped(value, width));
  const section = (title) => { lines.push(separator); center(title); };

  center(company?.nombreEmpresa || 'Restaurante');
  for (const line of companyService.receiptCompanyLines(company)) center(line);
  lines.push(separator);
  center('CIERRE OPERATIVO DE TURNO');
  pair('Fecha', snapshot?.businessDate || '');
  pair('Caja', snapshot?.shift?.cajaNombre || 'Caja');
  pair('Cajero', snapshot?.shift?.cajero || 'Cajero');
  pair('Apertura', dateTime(snapshot?.shift?.abiertoEn));
  pair('Cierre', dateTime(snapshot?.shift?.cerradoEn));
  pair('Estado', snapshot?.status || 'REVISAR');

  section('CONCILIACION GENERAL');
  pair('Cuentas cobradas', String(snapshot?.totals?.accountsCharged || 0));
  pair('Platos cocina', qty(snapshot?.totals?.kitchenDeliveredItems));
  pair('Valor facturado', cop(snapshot?.totals?.billedValue));
  pair('Valor liquidado', cop(snapshot?.totals?.settledValue));
  pair('Diferencia operativa', cop(snapshot?.totals?.difference));
  pair('Propinas', cop(snapshot?.totals?.tips));

  section('CANALES');
  const channelLabels = { MESAS: 'Mesas', MOSTRADOR: 'Mostrador', DOMICILIOS: 'Domicilios', PARA_LLEVAR: 'Para llevar' };
  for (const key of ['MESAS', 'MOSTRADOR', 'DOMICILIOS', 'PARA_LLEVAR']) {
    const row = snapshot?.channels?.[key] || {};
    pair(`${channelLabels[key]} (${Number(row.tickets || 0)})`, cop(row.settledValue));
    if (number(row.difference) !== 0) pair('  Diferencia', cop(row.difference));
  }

  section('PRODUCCION ENTREGADA');
  for (const key of ['COCINA', 'BARRA', 'POSTRES']) {
    const row = snapshot?.production?.[key] || {};
    pair(`${key} · ${qty(row.deliveredItems)} item(s)`, cop(row.value));
    if (Number(row.readyNotDelivered || 0)) pair('  Pendientes al cierre', String(row.readyNotDelivered));
  }

  section('MEDIOS DE PAGO');
  pair('Efectivo', cop(snapshot?.payments?.cash));
  pair('Transferencia / QR', cop(snapshot?.payments?.transfer));
  pair('Tarjeta', cop(snapshot?.payments?.card));
  pair('Crédito / cartera', cop(snapshot?.payments?.credit));
  if (number(snapshot?.payments?.other) !== 0) pair('Otros', cop(snapshot.payments.other));
  pair('TOTAL LIQUIDADO', cop(snapshot?.payments?.total));

  section('ARQUEO DE CAJA');
  pair('Fondo inicial', cop(snapshot?.cash?.openingBalance));
  pair('Ingresos efectivo', cop(snapshot?.cash?.cashIncome));
  pair('Ingresos voucher', cop(snapshot?.cash?.voucherIncome));
  pair('Egresos efectivo', cop(snapshot?.cash?.cashOut));
  pair('Efectivo esperado', cop(snapshot?.cash?.expectedCash));
  pair('Efectivo contado', cop(snapshot?.cash?.countedCash));
  pair('DESCUADRE', cop(snapshot?.cash?.difference));

  if (Array.isArray(snapshot?.operations) && snapshot.operations.length) {
    section('DETALLE DE OPERACIONES');
    for (const row of snapshot.operations) {
      const ref = `${row.channel || 'VENTA'} · ${row.reference || row.saleNumber || 'S/N'}`;
      pair(ref, cop(row.collectedValue));
      const meta = [row.saleNumber, row.paymentMethod, row.collectedBy].filter(Boolean).join(' · ');
      if (meta) lines.push(...receiptLayout.wrapText(`  ${meta}`, width));
      const when = timeOnly(row.collectedAt || row.orderAt || row.openedAt);
      if (when) lines.push(...receiptLayout.wrapText(`  Hora ${when} · ${row.state || ''}`, width));
    }
  }

  if (Array.isArray(snapshot?.movements) && snapshot.movements.length) {
    section('MOVIMIENTOS DE CAJA');
    for (const row of snapshot.movements) {
      const label = `${timeOnly(row.at)} ${row.type || 'MOV'}`.trim();
      pair(label, cop(row.amount));
      const detail = [row.reference, row.concept].filter(Boolean).join(' · ');
      if (detail) lines.push(...receiptLayout.wrapText(`  ${detail}`, width));
    }
  }

  section('EXCEPCIONES');
  if (!snapshot?.exceptions?.length) center('Sin excepciones detectadas');
  else for (const row of snapshot.exceptions) {
    lines.push(...receiptLayout.wrapText(`${row.severity || 'REVISAR'} · ${row.type || 'EXCEPCION'}`, width));
    const detail = [row.reference, row.station, row.at ? timeOnly(row.at) : null].filter(Boolean).join(' · ');
    if (detail) lines.push(...receiptLayout.wrapText(`  ${detail}`, width));
  }

  lines.push(separator);
  center(`Turno: ${String(snapshot?.shift?.id || '').slice(0, 12).toUpperCase()}`);
  center('CIERRE GUARDADO · C86');
  return lines;
}

function cashCloseReceiptLines(args) {
  return args?.snapshot?.marker === C86_MARKER ? c86CashCloseReceiptLines(args) : legacyCashCloseReceiptLines(args);
}

function buildCashCloseJob({ company, snapshot, printer, printRequestId = null }) {
  const transport = String(printer.transport || 'LAN').toUpperCase();
  const paperFormat = printer.format || 'TERMICA_80';
  const columns = cashCloseColumns(paperFormat);
  const c86 = snapshot?.marker === C86_MARKER;
  return {
    id: stableCashCloseJobId(snapshot.shift.id, printer, printRequestId),
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
      lines: cashCloseReceiptLines({ company, snapshot, paperFormat }),
      footer: receiptLayout.centerLine('VantixGC · Cierre de caja', columns),
      copies: 1,
      cut: true,
      paperFormat,
      receiptType: c86 ? 'RESTAURANT_CASH_SHIFT_CLOSE_C86' : 'RESTAURANT_CASH_SHIFT_CLOSE_V1',
      receiptLayout: c86 ? 'EPSON_FULL_WIDTH_48_C86' : 'EPSON_FULL_WIDTH_48_V1',
      columns,
      shiftId: snapshot.shift.id,
      printRequestId: printRequestId || null
    }
  };
}

function intentTokenHash(tenantId, sessionId) {
  return crypto.createHash('sha256').update(`restaurant-pos-receipt:${tenantId}:${sessionId}`).digest('hex');
}

function cashCloseIntentTokenHash(tenantId, shiftId) {
  return crypto.createHash('sha256').update(`restaurant-cash-close-receipt:${tenantId}:${shiftId}`).digest('hex');
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

async function queueShiftCloseSnapshotIntent(tenantId, shiftId, snapshot, client = prisma) {
  if (!snapshot?.shift?.id || snapshot.shift.id !== shiftId) return { queued: false, reason: 'SHIFT_SNAPSHOT_INVALID' };
  const shift = await client.aperturaCierreCaja.findFirst({ where: { id: shiftId, tenantId, estado: 'CERRADA' }, select: { id: true } });
  if (!shift) return { queued: false, reason: 'SHIFT_NOT_CLOSED' };
  const now = new Date();
  const printRequestId = crypto.randomUUID();
  const data = {
    tokenHash: cashCloseIntentTokenHash(tenantId, shiftId),
    tokenCiphertext: `CASH_SHIFT_CLOSE:${shiftId}`,
    tokenHint: String(shiftId).slice(-6),
    publicReference: `CIERRE-${String(shiftId).slice(0, 12).toUpperCase()}`,
    currentStatus: 'PENDING',
    timeline: [{ type: 'CASH_SHIFT_CLOSE_RECEIPT_QUEUED', at: now.toISOString(), shiftId, printRequestId, snapshot }],
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    completedAt: null,
    active: true,
    lastNotificationAt: now
  };
  const intent = await client.trackingLink.upsert({
    where: { tenantId_originType_originId: { tenantId, originType: CASH_SHIFT_ORIGIN_TYPE, originId: shiftId } },
    create: { tenantId, originType: CASH_SHIFT_ORIGIN_TYPE, originId: shiftId, ...data },
    update: data
  });
  return { queued: true, intentId: intent.id, shiftId, snapshot, printRequestId };
}

async function queueShiftCloseIntent(tenantId, shiftId, client = prisma) {
  const snapshot = await buildCashCloseSnapshot(tenantId, shiftId, client);
  if (!snapshot) return { queued: false, reason: 'SHIFT_NOT_CLOSED' };
  return queueShiftCloseSnapshotIntent(tenantId, shiftId, snapshot, client);
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

function cashCloseEnvelopeFromIntent(intent) {
  const timeline = Array.isArray(intent?.timeline) ? intent.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    if (event?.type === 'CASH_SHIFT_CLOSE_RECEIPT_QUEUED' && event?.snapshot?.shift?.id) {
      return { snapshot: event.snapshot, printRequestId: event.printRequestId || intent?.id || null };
    }
  }
  return null;
}

function cashCloseSnapshotFromIntent(intent) {
  return cashCloseEnvelopeFromIntent(intent)?.snapshot || null;
}

async function buildPendingReceiptJobs(tenantId) {
  const now = new Date();
  const [company, printers, intents] = await Promise.all([
    companyService.getCompanyProfile(tenantId),
    prisma.printerEndpoint.findMany({ where: { tenantId, active: true, transport: { in: ['LAN', 'WINDOWS'] } }, orderBy: { name: 'asc' } }),
    prisma.trackingLink.findMany({
      where: {
        tenantId,
        originType: { in: [ORIGIN_TYPE, CASH_SHIFT_ORIGIN_TYPE] },
        active: true,
        currentStatus: 'PENDING',
        expiresAt: { gt: now }
      },
      orderBy: { creadoEn: 'asc' },
      take: 80
    })
  ]);
  const selected = selectReceiptPrinters(printers);
  if (!selected.printers.length || !intents.length) {
    return { jobs: [], routing: selected.routing, receiptCount: 0, posReceiptCount: 0, cashCloseReceiptCount: 0, printerCount: selected.printers.length };
  }

  const posIntents = intents.filter((intent) => intent.originType === ORIGIN_TYPE);
  const closeIntents = intents.filter((intent) => intent.originType === CASH_SHIFT_ORIGIN_TYPE);
  const sessionIds = [...new Set(posIntents.map((intent) => intent.originId).filter(Boolean))];
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
  let posReceiptCount = 0;
  let cashCloseReceiptCount = 0;

  for (const intent of posIntents) {
    const session = sessionById.get(intent.originId);
    const sale = session ? saleById.get(session.saleId) : null;
    if (!session || !sale || !sale.detalles?.length || number(sale.saldo) > 0) continue;
    posReceiptCount += 1;
    for (const printer of selected.printers) jobs.push(buildReceiptJob({ company, sale, session, table: session.table, printer }));
  }

  for (const intent of closeIntents) {
    const envelope = cashCloseEnvelopeFromIntent(intent);
    if (!envelope?.snapshot) continue;
    cashCloseReceiptCount += 1;
    for (const printer of selected.printers) jobs.push(buildCashCloseJob({ company, snapshot: envelope.snapshot, printer, printRequestId: envelope.printRequestId }));
  }

  return {
    jobs,
    routing: selected.routing,
    receiptCount: posReceiptCount + cashCloseReceiptCount,
    posReceiptCount,
    cashCloseReceiptCount,
    printerCount: selected.printers.length
  };
}

module.exports = {
  POS_ROLE,
  DOCUMENT_ROLE,
  ORIGIN_TYPE,
  CASH_SHIFT_ORIGIN_TYPE,
  C86_MARKER,
  INTENT_TTL_MS,
  CASH_CLOSE_COLUMNS_80,
  CASH_CLOSE_COLUMNS_58,
  endpointKey,
  stableReceiptJobId,
  stableCashCloseJobId,
  uniquePhysicalPrinters,
  selectReceiptPrinters,
  number,
  moneyString,
  cop,
  qty,
  dateTime,
  timeOnly,
  cashCloseColumns,
  paperColumns: receiptLayout.paperColumns,
  receiptLines,
  buildReceiptJob,
  paymentKind,
  buildCashCloseSnapshot,
  legacyCashCloseReceiptLines,
  c86CashCloseReceiptLines,
  cashCloseReceiptLines,
  buildCashCloseJob,
  intentTokenHash,
  cashCloseIntentTokenHash,
  queueReceiptIntent,
  queueShiftCloseSnapshotIntent,
  queueShiftCloseIntent,
  queueReceiptForTableIfClosed,
  cashCloseEnvelopeFromIntent,
  cashCloseSnapshotFromIntent,
  buildPendingReceiptJobs,
  buildRecentReceiptJobs: buildPendingReceiptJobs
};