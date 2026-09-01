'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const visitPayments = require('./restaurant-visit-payments.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');

const ORIGIN_TYPE = 'RESTAURANT_ELECTRONIC_PAYMENT_REPORT';
const PRIMARY_ONLY_MS = 20_000;
const REPORT_TTL_MS = 12 * 60 * 60 * 1000;
const SHARED_WAITER_ROLE = 'MESERO_OPERATIVO_COMPARTIDO';

function timelineArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function latestReportMeta(row) {
  return [...timelineArray(row?.timeline)].reverse().find((event) => event?.type === 'ELECTRONIC_PAYMENT_REPORTED') || null;
}

async function activeWaiter(tenantId, userId, client = prisma) {
  if (!userId) return null;
  return client.user.findFirst({
    where:{ id:userId, tenantId, activo:true, rol:'MESERO' },
    select:{ id:true, nombre:true, rol:true }
  });
}

async function resolvePrimaryWaiter(verified, client = prisma) {
  const openedBy = await activeWaiter(verified.table.tenantId, verified.session.openedByUserId, client);
  if (openedBy) return openedBy;
  const firstWaiterOrder = await client.restaurantOrder.findFirst({
    where:{ tenantId:verified.table.tenantId, sessionId:verified.session.id, source:'MESERO', createdByUserId:{ not:null } },
    select:{ createdByUserId:true },
    orderBy:{ creadoEn:'asc' }
  });
  const firstOrderWaiter = await activeWaiter(verified.table.tenantId, firstWaiterOrder?.createdByUserId, client);
  if (firstOrderWaiter) return firstOrderWaiter;
  return activeWaiter(verified.table.tenantId, verified.table.assignedWaiterId, client);
}

function isEscalated(row, now = new Date()) {
  const meta = latestReportMeta(row) || {};
  if (!meta.primaryWaiterId) return true;
  if (row.currentStatus === 'ESCALATED') return true;
  const at = new Date(meta.escalatesAt || 0).getTime();
  return Number.isFinite(at) && at <= now.getTime();
}

async function ensureEscalated(row, now = new Date()) {
  if (!row?.active || row.currentStatus !== 'PENDING_PRIMARY' || !isEscalated(row, now)) return row;
  const timeline = [...timelineArray(row.timeline), { type:'ELECTRONIC_PAYMENT_ESCALATED', at:now.toISOString() }];
  const changed = await prisma.trackingLink.updateMany({
    where:{ id:row.id, active:true, currentStatus:'PENDING_PRIMARY' },
    data:{ currentStatus:'ESCALATED', timeline, lastNotificationAt:now }
  });
  if (changed.count !== 1) return prisma.trackingLink.findUnique({ where:{ id:row.id } });
  return prisma.trackingLink.findUnique({ where:{ id:row.id } });
}

async function paymentDestinations(tenantId, client = prisma) {
  return client.cajaBanco.findMany({
    where:{ tenantId, tipo:'BANCO', activo:true },
    select:{ id:true, nombre:true, banco:true, numeroCuenta:true },
    orderBy:{ nombre:'asc' },
    take:20
  });
}

async function saleTotal(tenantId, saleId, client = prisma) {
  const sale = await client.comprobanteComercial.findFirst({
    where:{ id:saleId, tenantId },
    select:{ id:true, total:true, estado:true }
  });
  if (!sale) throw new AppError(409, 'La cuenta de la mesa no está disponible', 'RESTAURANT_ELECTRONIC_SALE_NOT_FOUND');
  return { ...sale, total:money(sale.total).toString() };
}

function publicReport(row) {
  if (!row) return { state:'READY', reported:false, confirmed:false };
  const meta = latestReportMeta(row) || {};
  if (row.currentStatus === 'CONFIRMED') return {
    state:'CONFIRMED', reported:true, confirmed:true, reportId:row.id,
    reportedAt:meta.at || row.creadoEn, confirmedAt:row.completedAt || null,
    destination:{ id:meta.cajaBancoId || null, nombre:meta.accountName || null, banco:meta.bankName || null, numeroCuenta:meta.accountNumber || null },
    reference:meta.reference || null, amount:meta.amount || null
  };
  if (row.currentStatus === 'REJECTED') return { state:'REJECTED', reported:true, confirmed:false, reportId:row.id };
  if (row.active && ['PENDING_PRIMARY','ESCALATED','CONFIRMING'].includes(row.currentStatus)) return {
    state:row.currentStatus === 'CONFIRMING' ? 'CONFIRMING' : 'REPORTED',
    reported:true, confirmed:false, reportId:row.id,
    reportedAt:meta.at || row.creadoEn,
    destination:{ id:meta.cajaBancoId || null, nombre:meta.accountName || null, banco:meta.bankName || null, numeroCuenta:meta.accountNumber || null },
    reference:meta.reference || null, amount:meta.amount || null
  };
  return { state:'READY', reported:false, confirmed:false };
}

async function reportRow(tenantId, sessionId) {
  return prisma.trackingLink.findFirst({ where:{ tenantId, originType:ORIGIN_TYPE, originId:sessionId } });
}

async function clientContext(qrToken, rawVisitToken) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  const [sale, destinations, row] = await Promise.all([
    saleTotal(verified.table.tenantId, verified.session.saleId),
    paymentDestinations(verified.table.tenantId),
    reportRow(verified.table.tenantId, verified.session.id)
  ]);
  return {
    sessionId:verified.session.id,
    table:{ id:verified.table.id, code:verified.table.code, name:verified.table.name },
    seatNumber:verified.device.seatNumber || null,
    accountRequested:Boolean(verified.session.accountRequestedAt || verified.session.accountPreparedAt || verified.session.cashierRequestedAt),
    amount:sale.total,
    destinations,
    electronicAvailable:destinations.length > 0,
    report:publicReport(row)
  };
}

async function reportPayment(qrToken, rawVisitToken, input = {}) {
  const verified = await visitPayments.verifyVisit(qrToken, rawVisitToken);
  if (!verified.session.accountRequestedAt && !verified.session.accountPreparedAt && !verified.session.cashierRequestedAt) {
    throw new AppError(409, 'Primero solicita la cuenta', 'RESTAURANT_ELECTRONIC_ACCOUNT_NOT_REQUESTED');
  }
  if (verified.session.splitMetadata) {
    throw new AppError(409, 'La cuenta ya está en proceso de cobro. Solicita ayuda al mesero.', 'RESTAURANT_ELECTRONIC_ACCOUNT_ALREADY_PREPARED');
  }
  const reference = String(input.reference || '').trim().slice(0, 160) || null;
  const destination = await prisma.cajaBanco.findFirst({
    where:{ id:String(input.cajaBancoId || ''), tenantId:verified.table.tenantId, tipo:'BANCO', activo:true },
    select:{ id:true, nombre:true, banco:true, numeroCuenta:true }
  });
  if (!destination) throw new AppError(400, 'Selecciona un medio de pago electrónico disponible', 'RESTAURANT_ELECTRONIC_DESTINATION_INVALID');
  const sale = await saleTotal(verified.table.tenantId, verified.session.saleId);
  if (!money(sale.total).gt(0)) throw new AppError(409, 'La cuenta no tiene saldo para pagar', 'RESTAURANT_ELECTRONIC_ZERO_TOTAL');

  const existing = await reportRow(verified.table.tenantId, verified.session.id);
  if (existing?.currentStatus === 'CONFIRMED') return publicReport(existing);
  if (existing?.active && existing.currentStatus === 'CONFIRMING') return publicReport(existing);

  const primary = await resolvePrimaryWaiter(verified);
  const now = new Date();
  const escalatesAt = new Date(now.getTime() + (primary ? PRIMARY_ONLY_MS : 0));
  const raw = crypto.randomBytes(32).toString('base64url');
  const event = {
    type:'ELECTRONIC_PAYMENT_REPORTED', at:now.toISOString(), sessionId:verified.session.id,
    tableId:verified.table.id, tableCode:verified.table.code, tableName:verified.table.name,
    seatNumber:verified.device.seatNumber || null, qrVisitDeviceId:verified.device.id,
    primaryWaiterId:primary?.id || null, escalatesAt:escalatesAt.toISOString(),
    cajaBancoId:destination.id, accountName:destination.nombre, bankName:destination.banco || null,
    accountNumber:destination.numeroCuenta || null, reference, amount:sale.total
  };
  const row = await prisma.trackingLink.upsert({
    where:{ tenantId_originType_originId:{ tenantId:verified.table.tenantId, originType:ORIGIN_TYPE, originId:verified.session.id } },
    create:{
      tenantId:verified.table.tenantId,
      tokenHash:crypto.createHash('sha256').update(raw).digest('hex'), tokenCiphertext:`ELECTRONIC_PAYMENT:${verified.session.id}`,
      tokenHint:raw.slice(-6), originType:ORIGIN_TYPE, originId:verified.session.id,
      publicReference:primary?.id || 'ALL', currentStatus:primary ? 'PENDING_PRIMARY' : 'ESCALATED',
      timeline:[event], expiresAt:new Date(now.getTime() + REPORT_TTL_MS), active:true, completedAt:null,
      lastNotificationAt:now, createdByUserId:null
    },
    update:{
      publicReference:primary?.id || 'ALL', currentStatus:primary ? 'PENDING_PRIMARY' : 'ESCALATED',
      timeline:[event], expiresAt:new Date(now.getTime() + REPORT_TTL_MS), active:true, completedAt:null, lastNotificationAt:now
    }
  });
  return publicReport(row);
}

async function waiterReportsSnapshot(tenantId, waiterUserId) {
  const waiter = await activeWaiter(tenantId, waiterUserId);
  if (!waiter) throw new AppError(403, 'Sólo un mesero activo puede confirmar pagos electrónicos', 'RESTAURANT_ELECTRONIC_WAITER_FORBIDDEN');
  const now = new Date();
  let rows = await prisma.trackingLink.findMany({
    where:{ tenantId, originType:ORIGIN_TYPE, active:true, currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] }, expiresAt:{ gt:now } },
    orderBy:{ creadoEn:'asc' }, take:100
  });
  const sessionIds = [...new Set(rows.map((row) => row.originId))];
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where:{ tenantId, id:{ in:sessionIds }, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    include:{ table:true }
  }) : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const staleIds = rows.filter((row) => !byId.has(row.originId)).map((row) => row.id);
  if (staleIds.length) {
    await prisma.trackingLink.updateMany({ where:{ id:{ in:staleIds }, active:true }, data:{ active:false, currentStatus:'CLOSED', completedAt:now } }).catch(() => {});
    const stale = new Set(staleIds); rows = rows.filter((row) => !stale.has(row.id));
  }
  const normalized = [];
  for (const row of rows) normalized.push(await ensureEscalated(row, now));
  return normalized.filter(Boolean).filter((row) => {
    const meta = latestReportMeta(row) || {};
    return meta.primaryWaiterId === waiterUserId || isEscalated(row, now);
  }).map((row) => {
    const meta = latestReportMeta(row) || {};
    const session = byId.get(row.originId);
    return {
      id:row.id, sessionId:row.originId,
      state:isEscalated(row, now) ? 'ESCALATED' : 'PENDING_PRIMARY',
      priority:meta.primaryWaiterId === waiterUserId ? 'PRIMARY' : 'GENERAL', escalated:isEscalated(row, now),
      createdAt:meta.at || row.creadoEn, escalatesAt:meta.escalatesAt || null,
      table:{ id:meta.tableId || session?.tableId || null, code:meta.tableCode || session?.table?.code || null, name:meta.tableName || session?.table?.name || null },
      seatNumber:meta.seatNumber || null, amount:meta.amount || null, reference:meta.reference || null,
      destination:{ id:meta.cajaBancoId || null, nombre:meta.accountName || null, banco:meta.bankName || null, numeroCuenta:meta.accountNumber || null }
    };
  });
}

async function confirmPayment(tenantId, waiterUserId, reportId) {
  const waiter = await activeWaiter(tenantId, waiterUserId);
  if (!waiter) throw new AppError(403, 'Sólo un mesero activo puede confirmar pagos electrónicos', 'RESTAURANT_ELECTRONIC_WAITER_FORBIDDEN');
  let row = await prisma.trackingLink.findFirst({ where:{ id:reportId, tenantId, originType:ORIGIN_TYPE } });
  if (!row) throw new AppError(404, 'Reporte de pago electrónico no encontrado', 'RESTAURANT_ELECTRONIC_REPORT_NOT_FOUND');
  if (row.currentStatus === 'CONFIRMED') return { confirmed:true, alreadyConfirmed:true, reportId:row.id };
  if (!row.active || !['PENDING_PRIMARY','ESCALATED'].includes(row.currentStatus)) {
    throw new AppError(409, 'Este reporte ya no está disponible para confirmar', 'RESTAURANT_ELECTRONIC_REPORT_NOT_ACTIVE');
  }
  row = await ensureEscalated(row);
  const meta = latestReportMeta(row) || {};
  if (!isEscalated(row) && meta.primaryWaiterId !== waiterUserId) {
    throw new AppError(403, 'Este pago todavía corresponde al mesero que abrió la atención', 'RESTAURANT_ELECTRONIC_PRIMARY_ONLY');
  }
  const claimed = await prisma.trackingLink.updateMany({
    where:{ id:row.id, tenantId, active:true, currentStatus:{ in:['PENDING_PRIMARY','ESCALATED'] } },
    data:{ currentStatus:'CONFIRMING', lastNotificationAt:new Date() }
  });
  if (claimed.count !== 1) return { confirmed:false, alreadyConfirming:true, reportId:row.id };

  try {
    const session = await prisma.restaurantTableSession.findFirst({
      where:{ id:row.originId, tenantId, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } }, include:{ table:true }
    });
    if (!session) throw new AppError(409, 'La mesa ya no tiene una visita activa', 'RESTAURANT_ELECTRONIC_TABLE_CLOSED');
    const destination = await prisma.cajaBanco.findFirst({
      where:{ id:meta.cajaBancoId, tenantId, tipo:'BANCO', activo:true }, select:{ id:true }
    });
    if (!destination) throw new AppError(409, 'El destino del pago electrónico ya no está activo', 'RESTAURANT_ELECTRONIC_DESTINATION_INACTIVE');

    const actor = { ...waiter, rol:SHARED_WAITER_ROLE };
    let summary = await visitPayments.paymentSummary(tenantId, actor, session.tableId);
    if (!summary.prepared) {
      summary = await visitPayments.preparePaymentPlan(tenantId, actor, session.tableId, { mode:'TOGETHER', tipAmount:0 });
    }
    const pending = (summary.parts || []).filter((part) => !part.paid);
    if (pending.length !== 1 || pending[0].key !== 'P1') {
      throw new AppError(409, 'La cuenta está dividida en varias partes. Confirma este pago desde Caja.', 'RESTAURANT_ELECTRONIC_SPLIT_REQUIRES_CASHIER');
    }
    const paid = await settlementFinalizer.registerPartPaymentFinalized(tenantId, actor, session.tableId, {
      partKey:'P1', metodoPago:'TRANSFERENCIA', cajaBancoId:destination.id, referencia:meta.reference || `QR mesa ${meta.tableCode || session.table.code}`
    });
    const now = new Date();
    const timeline = [...timelineArray(row.timeline), { type:'ELECTRONIC_PAYMENT_CONFIRMED', at:now.toISOString(), waiterUserId, waiterName:waiter.nombre || null }];
    await prisma.trackingLink.updateMany({
      where:{ id:row.id, tenantId },
      data:{ active:false, currentStatus:'CONFIRMED', completedAt:now, lastNotificationAt:now, timeline }
    });
    return { confirmed:true, alreadyConfirmed:false, reportId:row.id, tableId:session.tableId, sessionId:session.id, paymentSummary:paid };
  } catch (error) {
    const now = new Date();
    const restored = isEscalated(row, now) ? 'ESCALATED' : 'PENDING_PRIMARY';
    await prisma.trackingLink.updateMany({
      where:{ id:row.id, tenantId, active:true, currentStatus:'CONFIRMING' },
      data:{ currentStatus:restored, lastNotificationAt:now }
    }).catch(() => {});
    throw error;
  }
}

async function reportStatusById(tenantId, reportId) {
  const row = await prisma.trackingLink.findFirst({ where:{ id:reportId, tenantId, originType:ORIGIN_TYPE } });
  return publicReport(row);
}

module.exports = {
  ORIGIN_TYPE,
  PRIMARY_ONLY_MS,
  clientContext,
  reportPayment,
  waiterReportsSnapshot,
  confirmPayment,
  reportStatusById,
  publicReport,
  paymentDestinations
};
