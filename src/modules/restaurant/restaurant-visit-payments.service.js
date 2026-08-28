'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, decimal } = require('../../utils/decimal');
const restaurant = require('./restaurant.service');
const sales = require('../commercial/sales.service');
const treasury = require('../treasury/treasury.service');

const VISIT_MAX_FAILURES = 5;
const VISIT_LOCK_MINUTES = 10;
const VISIT_ORDER_WINDOW_MS = 60_000;
const VISIT_MAX_ORDERS_PER_WINDOW = 6;
const VISIT_MAX_UNITS_PER_ORDER = 40;
const SPLIT_VERSION = 'RESTAURANT_SPLIT_PAYMENTS_V1';

function visitSecret() {
  const secret = String(process.env.RESTAURANT_QR_VISIT_SECRET || process.env.JWT_SECRET || '');
  if (secret.length < 32) throw new AppError(500, 'Configure RESTAURANT_QR_VISIT_SECRET o JWT_SECRET para proteger las visitas QR', 'RESTAURANT_QR_VISIT_SECRET_REQUIRED');
  return secret;
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function visitCode(session) {
  const digest = crypto.createHmac('sha256', visitSecret()).update(`restaurant-visit|${session.id}|${session.qrVisitNonce}`).digest();
  return String(digest.readUInt32BE(0) % 10000).padStart(4, '0');
}

function safeCodeEqual(expected, actual) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(actual || '').trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertTableAccess(user, table) {
  if (user?.rol === 'MESERO' && table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa no está asignada a este mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
}

async function currentSessionForTable(table, client = prisma) {
  return client.restaurantTableSession.findFirst({
    where: { tenantId: table.tenantId, tableId: table.id, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    orderBy: { openedAt: 'desc' }
  });
}

async function tableByQr(qrToken, client = prisma) {
  const table = await client.restaurantTable.findUnique({ where: { qrToken } });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  return table;
}

async function staffVisitStatus(tenantId, user, tableId) {
  const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  assertTableAccess(user, table);
  const session = await currentSessionForTable(table);
  if (!session) return { open: false, table: { id: table.id, name: table.name }, visitCode: null, activeDevices: 0 };
  const activeDevices = await prisma.restaurantQrVisitDevice.count({ where: { tenantId, sessionId: session.id, revokedAt: null } });
  return {
    open: true,
    table: { id: table.id, name: table.name },
    sessionId: session.id,
    guestCount: session.guestCount,
    visitCode: visitCode(session),
    activeDevices,
    lockedUntil: session.qrVisitLockedUntil
  };
}

async function rotateVisit(tenantId, user, tableId) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    assertTableAccess(user, table);
    const session = await currentSessionForTable(table, tx);
    if (!session) throw new AppError(409, 'La mesa debe estar abierta para cambiar el código de visita', 'RESTAURANT_QR_TABLE_NOT_OPEN');
    await tx.restaurantQrVisitDevice.updateMany({ where: { tenantId, sessionId: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: { qrVisitNonce: crypto.randomUUID(), qrVisitFailedAttempts: 0, qrVisitLockedUntil: null }
    });
    return { sessionId: updated.id, visitCode: visitCode(updated), activeDevices: 0 };
  });
}

function normalizeSeat(session, seatNumber) {
  const guestCount = Math.max(Number(session.guestCount || 1), 1);
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > guestCount) {
    throw new AppError(400, 'Selecciona una persona válida de esta mesa', 'RESTAURANT_SEAT_INVALID', { guestCount });
  }
  return seat;
}

async function authorizeVisit(qrToken, code, seatNumber) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  return prisma.$transaction(async (tx) => {
    const table = await tableByQr(qrToken, tx);
    const session = await currentSessionForTable(table, tx);
    if (!session) throw new AppError(409, 'La mesa todavía no está abierta', 'RESTAURANT_QR_TABLE_NOT_OPEN');
    if (session.splitMetadata) throw new AppError(409, 'La cuenta de esta mesa ya está en proceso de cobro', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');
    const now = new Date();
    if (session.qrVisitLockedUntil && new Date(session.qrVisitLockedUntil) > now) {
      throw new AppError(429, 'Código temporalmente bloqueado por varios intentos incorrectos. Solicita uno nuevo al mesero.', 'RESTAURANT_QR_VISIT_LOCKED', { lockedUntil: session.qrVisitLockedUntil });
    }
    const expected = visitCode(session);
    if (!safeCodeEqual(expected, String(code || '').trim())) {
      const attempts = Number(session.qrVisitFailedAttempts || 0) + 1;
      const lockedUntil = attempts >= VISIT_MAX_FAILURES ? new Date(Date.now() + VISIT_LOCK_MINUTES * 60_000) : null;
      await tx.restaurantTableSession.update({ where: { id: session.id }, data: { qrVisitFailedAttempts: attempts >= VISIT_MAX_FAILURES ? 0 : attempts, qrVisitLockedUntil: lockedUntil } });
      throw new AppError(403, lockedUntil ? 'Demasiados intentos. Solicita al mesero cambiar el código.' : 'Código de mesa incorrecto', lockedUntil ? 'RESTAURANT_QR_VISIT_LOCKED' : 'RESTAURANT_QR_VISIT_CODE_INVALID', { attemptsRemaining: lockedUntil ? 0 : VISIT_MAX_FAILURES - attempts, lockedUntil });
    }
    const activeDevices = await tx.restaurantQrVisitDevice.count({ where: { tenantId: table.tenantId, sessionId: session.id, revokedAt: null } });
    const maxDevices = Math.min(Math.max(Number(session.guestCount || 1) * 2 + 2, 4), 20);
    if (activeDevices >= maxDevices) throw new AppError(429, 'Esta mesa ya tiene demasiados dispositivos autorizados. Solicita al mesero reiniciar el acceso QR.', 'RESTAURANT_QR_VISIT_DEVICE_LIMIT');
    const seat = normalizeSeat(session, seatNumber);
    const device = await tx.restaurantQrVisitDevice.create({ data: { tenantId: table.tenantId, sessionId: session.id, tokenHash, seatNumber: seat } });
    await tx.restaurantTableSession.update({ where: { id: session.id }, data: { qrVisitFailedAttempts: 0, qrVisitLockedUntil: null } });
    return { visitToken: rawToken, sessionId: session.id, seatNumber: device.seatNumber, guestCount: session.guestCount, expiresWhenTableCloses: true };
  });
}

async function verifyVisit(qrToken, rawToken, client = prisma) {
  const table = await tableByQr(qrToken, client);
  const session = await currentSessionForTable(table, client);
  if (!session) throw new AppError(409, 'La mesa todavía no está abierta', 'RESTAURANT_QR_TABLE_NOT_OPEN');
  if (!rawToken) throw new AppError(401, 'Ingresa el código de la mesa para autorizar este teléfono', 'RESTAURANT_QR_VISIT_REQUIRED');
  const device = await client.restaurantQrVisitDevice.findFirst({
    where: { tenantId: table.tenantId, sessionId: session.id, tokenHash: hashToken(rawToken), revokedAt: null }
  });
  if (!device) throw new AppError(401, 'La autorización de este teléfono ya no es válida', 'RESTAURANT_QR_VISIT_INVALID');
  if (Number(device.seatNumber || 0) > Number(session.guestCount || 1)) throw new AppError(409, 'La persona asociada a este teléfono ya no existe en la mesa', 'RESTAURANT_QR_VISIT_SEAT_INVALID');
  if (client === prisma) await prisma.restaurantQrVisitDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { table, session, device };
}

async function describeVisit(qrToken, rawToken) {
  const table = await tableByQr(qrToken);
  const session = await currentSessionForTable(table);
  if (!session) return { open: false, authorized: false, guestCount: 0, seatNumber: null };
  if (!rawToken) return { open: true, authorized: false, guestCount: session.guestCount, seatNumber: null };
  try {
    const verified = await verifyVisit(qrToken, rawToken);
    return { open: true, authorized: true, guestCount: session.guestCount, seatNumber: verified.device.seatNumber };
  } catch (error) {
    if (['RESTAURANT_QR_VISIT_INVALID', 'RESTAURANT_QR_VISIT_REQUIRED'].includes(error.code)) return { open: true, authorized: false, guestCount: session.guestCount, seatNumber: null };
    throw error;
  }
}

async function changeVisitSeat(qrToken, rawToken, seatNumber) {
  const verified = await verifyVisit(qrToken, rawToken);
  if (verified.session.splitMetadata) throw new AppError(409, 'La cuenta ya está en proceso de cobro', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');
  const seat = normalizeSeat(verified.session, seatNumber);
  const device = await prisma.restaurantQrVisitDevice.update({ where: { id: verified.device.id }, data: { seatNumber: seat, lastSeenAt: new Date() } });
  return { seatNumber: device.seatNumber, guestCount: verified.session.guestCount };
}

async function placeAuthorizedQrOrder(qrToken, rawToken, input) {
  const verified = await verifyVisit(qrToken, rawToken);
  if (verified.session.splitMetadata) throw new AppError(409, 'La cuenta ya está en proceso de cobro; no se pueden agregar más productos', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');
  const units = (input.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (units > VISIT_MAX_UNITS_PER_ORDER) throw new AppError(400, `Máximo ${VISIT_MAX_UNITS_PER_ORDER} unidades por envío QR`, 'RESTAURANT_QR_ORDER_TOO_LARGE');
  const recent = await prisma.restaurantOrder.count({
    where: { tenantId: verified.table.tenantId, sessionId: verified.session.id, source: 'QR', qrVisitDeviceId: verified.device.id, creadoEn: { gte: new Date(Date.now() - VISIT_ORDER_WINDOW_MS) } }
  });
  if (recent >= VISIT_MAX_ORDERS_PER_WINDOW) throw new AppError(429, 'Demasiados pedidos seguidos desde este teléfono. Espera un momento.', 'RESTAURANT_QR_ORDER_RATE_LIMIT');
  const order = await restaurant.placeQrOrder(qrToken, input);
  await prisma.$transaction(async (tx) => {
    await tx.restaurantOrder.update({ where: { id: order.id }, data: { qrVisitDeviceId: verified.device.id } });
    await tx.restaurantOrderItem.updateMany({ where: { tenantId: verified.table.tenantId, orderId: order.id }, data: { seatNumber: verified.device.seatNumber } });
  });
  return { ...order, items: (order.items || []).map((item) => ({ ...item, seatNumber: verified.device.seatNumber })) };
}

async function ensureFinalConsumer(tx, tenantId) {
  return tx.tercero.upsert({
    where: { tenantId_identificacion: { tenantId, identificacion: 'CONSUMIDOR-FINAL-RESTAURANTE' } },
    create: { tenantId, tipo: 'CLIENTE', tipoDocumento: 'OTRO', identificacion: 'CONSUMIDOR-FINAL-RESTAURANTE', nombre: 'Consumidor final restaurante', razonSocial: 'Consumidor final restaurante' },
    update: { activo: true, nombre: 'Consumidor final restaurante' }
  });
}

async function sessionForSettlement(tx, tenantId, tableId) {
  const session = await tx.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true }
  });
  if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');
  return session;
}

async function buildSplitPlan(tx, tenantId, session, sale, input) {
  const mode = String(input.mode || 'TOGETHER').toUpperCase();
  let computed;
  if (mode === 'TOGETHER') {
    computed = { mode: 'NONE', total: money(sale.total).toString(), parts: [{ name: 'Cuenta completa', amount: money(sale.total).toString(), saleDetailIds: (sale.detalles || []).map((x) => x.id) }] };
  } else if (mode === 'EQUAL') {
    computed = restaurant.computeSplit(sale, 0, { mode: 'EQUAL', parts: Math.max(Number(input.parts || session.guestCount || 2), 2) });
  } else if (mode === 'BY_ITEM') {
    computed = restaurant.computeSplit(sale, 0, { mode: 'BY_ITEM', assignments: input.assignments || [] });
  } else if (mode === 'BY_SEAT') {
    const orderIds = (await tx.restaurantOrder.findMany({ where: { tenantId, sessionId: session.id, state: { not: 'CANCELADO' } }, select: { id: true } })).map((row) => row.id);
    const items = orderIds.length ? await tx.restaurantOrderItem.findMany({ where: { tenantId, orderId: { in: orderIds } }, select: { saleDetailId: true, seatNumber: true } }) : [];
    const bySeat = new Map();
    for (const item of items) {
      const seat = Number(item.seatNumber || 0);
      if (!Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
        throw new AppError(409, 'Hay productos sin persona asignada. Usa "Elegir productos" o divide en partes iguales.', 'RESTAURANT_SPLIT_UNASSIGNED_ITEMS');
      }
      if (!bySeat.has(seat)) bySeat.set(seat, []);
      bySeat.get(seat).push(item.saleDetailId);
    }
    const assignments = [...bySeat.entries()].sort((a, b) => a[0] - b[0]).map(([seat, saleDetailIds]) => ({ name: `Persona ${seat}`, saleDetailIds }));
    computed = restaurant.computeSplit(sale, 0, { mode: 'BY_ITEM', assignments });
    computed.mode = 'BY_SEAT';
  } else {
    throw new AppError(400, 'Modo de cuenta separada inválido', 'RESTAURANT_SPLIT_MODE_INVALID');
  }
  const parts = (computed.parts || []).map((part, index) => ({
    key: `P${index + 1}`,
    name: part.name || `Parte ${index + 1}`,
    saleDetailIds: part.saleDetailIds || [],
    saleAmount: money(part.amount).toString()
  }));
  return { version: SPLIT_VERSION, mode: computed.mode === 'NONE' ? 'TOGETHER' : computed.mode, total: money(computed.total).toString(), parts };
}

async function createFiscalRecordInTx(tx, tenantId, session, emitted, config) {
  const existing = await tx.restaurantFiscalDocument.findFirst({ where: { tenantId, saleId: emitted.id } });
  if (existing) return existing;
  if (config.dianRealEnabled && !emitted.dianDocument) throw new AppError(409, 'Restaurante está marcado DIAN real, pero la venta no generó documento fiscal en el Core', 'RESTAURANT_DIAN_DOCUMENT_REQUIRED');
  if (!emitted.dianDocument && !config.allowSimulatedDocumentEquivalent) throw new AppError(409, 'Documento Equivalente simulado deshabilitado y DIAN real no generó documento', 'RESTAURANT_SIMULATED_FISCAL_DISABLED');
  return tx.restaurantFiscalDocument.create({
    data: {
      tenantId,
      sessionId: session.id,
      saleId: emitted.id,
      mode: emitted.dianDocument ? 'DIAN' : 'SIMULATED',
      documentType: 'DOCUMENTO_EQUIVALENTE_POS',
      internalNumber: emitted.numero,
      dianDocumentId: emitted.dianDocument?.id || null,
      simulatedData: emitted.dianDocument ? null : {
        label: 'DOCUMENTO EQUIVALENTE SIMULADO', fiscalAcceptance: false,
        reason: 'DIAN/PT real no habilitado en este tenant', saleNumber: emitted.numero,
        subtotal: String(emitted.subtotal), ivaTotal: String(emitted.ivaTotal), impoconsumoTotal: String(emitted.impoconsumoTotal),
        saleTotal: String(emitted.total), tipAmount: '0.00', grandTotal: String(emitted.total), generatedAt: new Date().toISOString()
      }
    }
  });
}

async function preparePaymentPlan(tenantId, user, tableId, input) {
  if (money(input.tipAmount || 0).gt(0)) throw new AppError(409, 'La propina en cuentas con pagos parciales se habilitará en una fase posterior; registra la cuenta sin propina.', 'RESTAURANT_SPLIT_TIP_NOT_SUPPORTED');
  return prisma.$transaction(async (tx) => {
    const session = await sessionForSettlement(tx, tenantId, tableId);
    assertTableAccess(user, session.table);
    if (session.splitMetadata) return settlementSummaryInTx(tx, tenantId, session);
    const draft = await tx.restaurantOrder.findFirst({ where: { tenantId, sessionId: session.id, state: 'BORRADOR' }, include: { _count: { select: { items: true } } } });
    if (draft?._count?.items) throw new AppError(409, 'Hay un pedido del mesero sin enviar. Envíalo o retíralo antes de preparar la cuenta.', 'RESTAURANT_UNSENT_DRAFT_ORDER');
    const sale = await tx.comprobanteComercial.findFirst({ where: { id: session.saleId, tenantId, estado: 'BORRADOR' }, include: { detalles: true } });
    if (!sale || !sale.detalles.length) throw new AppError(409, 'La mesa no tiene consumos disponibles para cobrar', 'RESTAURANT_EMPTY_TABLE_CLOSE');
    const plan = await buildSplitPlan(tx, tenantId, session, sale, input);
    const consumer = await ensureFinalConsumer(tx, tenantId);
    await tx.comprobanteComercial.update({ where: { id: sale.id }, data: { terceroId: consumer.id, formaPago: 'CREDITO', cajaBancoId: null } });
    const emitted = await sales.emitSaleInTx(tx, tenantId, user.id, sale.id, 'DOCUMENTO_EQUIVALENTE_POS');
    const config = await restaurant.getOrCreateConfig(tenantId, tx);
    await createFiscalRecordInTx(tx, tenantId, session, emitted, config);
    const now = new Date();
    const updated = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: { state: 'CUENTA_PEDIDA', accountPreparedAt: now, cashierRequestedAt: now, accountRequestedAt: now, splitMode: plan.mode, splitMetadata: { ...plan, preparedAt: now.toISOString(), preparedByUserId: user.id }, tipAmount: 0 }
    });
    await tx.restaurantTable.update({ where: { id: session.tableId }, data: { state: 'CUENTA_PEDIDA' } });
    await tx.restaurantQrVisitDevice.updateMany({ where: { tenantId, sessionId: session.id, revokedAt: null }, data: { revokedAt: now } });
    return settlementSummaryInTx(tx, tenantId, { ...updated, table: session.table });
  });
}

async function settlementSummaryInTx(tx, tenantId, session) {
  const sale = await tx.comprobanteComercial.findFirst({ where: { id: session.saleId, tenantId }, select: { id: true, numero: true, estado: true, total: true, saldo: true } });
  const payments = await tx.restaurantSessionPayment.findMany({ where: { tenantId, sessionId: session.id }, orderBy: { paidAt: 'asc' } });
  const paymentByPart = new Map(payments.map((row) => [row.partKey, row]));
  const plan = session.splitMetadata && typeof session.splitMetadata === 'object' ? session.splitMetadata : null;
  const parts = (plan?.parts || []).map((part) => ({ ...part, paid: paymentByPart.has(part.key), payment: paymentByPart.get(part.key) || null }));
  const plannedTotal = plan ? money(plan.total) : money(sale?.total || 0);
  const paidTotal = money(payments.reduce((acc, row) => decimal(acc).plus(row.saleAmount || 0), decimal(0)));
  return {
    prepared: Boolean(plan),
    closed: session.state === 'CERRADA',
    sessionId: session.id,
    tableId: session.tableId,
    tableName: session.table?.name || null,
    guestCount: session.guestCount,
    mode: plan?.mode || null,
    parts,
    total: plannedTotal.toString(),
    paid: paidTotal.toString(),
    remaining: money(decimal(plannedTotal).minus(paidTotal)).toString(),
    sale
  };
}

async function paymentSummary(tenantId, user, tableId) {
  const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  assertTableAccess(user, table);
  let session = await prisma.restaurantTableSession.findFirst({ where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } }, orderBy: { openedAt: 'desc' }, include: { table: true } });
  if (!session) session = await prisma.restaurantTableSession.findFirst({ where: { tenantId, tableId, splitMode: { not: null } }, orderBy: { openedAt: 'desc' }, include: { table: true } });
  if (!session) return { prepared: false, closed: false, tableId, tableName: table.name, guestCount: 0, parts: [], total: '0.00', paid: '0.00', remaining: '0.00', sale: null };
  return prisma.$transaction((tx) => settlementSummaryInTx(tx, tenantId, session));
}

async function registerPartPayment(tenantId, user, tableId, input) {
  const pre = await prisma.$transaction(async (tx) => {
    const session = await sessionForSettlement(tx, tenantId, tableId);
    assertTableAccess(user, session.table);
    const summary = await settlementSummaryInTx(tx, tenantId, session);
    if (!summary.prepared) throw new AppError(409, 'Primero prepara la cuenta separada', 'RESTAURANT_SPLIT_NOT_PREPARED');
    const part = summary.parts.find((row) => row.key === input.partKey);
    if (!part) throw new AppError(404, 'Parte de cuenta no encontrada', 'RESTAURANT_SPLIT_PART_NOT_FOUND');
    if (part.paid) return { alreadyPaid: true, summary, session, part, cashShiftId: part.payment?.cashShiftId || null };
    const caja = await treasury.getCajaBanco(tenantId, input.cajaBancoId, tx);
    const method = String(input.metodoPago || '').toUpperCase();
    if (!['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'].includes(method)) throw new AppError(400, 'Método de pago inválido', 'RESTAURANT_PART_PAYMENT_METHOD_INVALID');
    if (method === 'EFECTIVO' && caja.tipo !== 'CAJA') throw new AppError(400, 'El efectivo debe registrarse en una caja', 'RESTAURANT_PART_PAYMENT_CASH_ACCOUNT_INVALID');
    if (method !== 'EFECTIVO' && caja.tipo !== 'BANCO') throw new AppError(400, 'Transferencia o tarjeta deben registrarse en una cuenta bancaria', 'RESTAURANT_PART_PAYMENT_BANK_ACCOUNT_INVALID');
    let cashShiftId = null;
    if (method === 'EFECTIVO') {
      const shift = await tx.aperturaCierreCaja.findFirst({ where: { tenantId, cajaBancoId: caja.id, userId: user.id, estado: 'ABIERTA' }, orderBy: { abiertoEn: 'desc' } });
      if (!shift) throw new AppError(409, 'Abra el turno de caja antes de cobrar esta parte en efectivo', 'RESTAURANT_CASH_SHIFT_REQUIRED');
      cashShiftId = shift.id;
    }
    return { alreadyPaid: false, summary, session, part, cashShiftId, method };
  });
  if (pre.alreadyPaid) return pre.summary;

  const sourceId = `REST-SPLIT-${pre.session.id}-${pre.part.key}`;
  const payment = await treasury.registerPayment(tenantId, user.id, {
    documentoId: pre.session.saleId,
    cajaBancoId: input.cajaBancoId,
    metodoPago: pre.method,
    monto: pre.part.saleAmount,
    referencia: input.referencia || `${pre.session.table.name} · ${pre.part.name}`,
    sourceId
  });

  return prisma.$transaction(async (tx) => {
    await tx.restaurantSessionPayment.upsert({
      where: { sessionId_partKey: { sessionId: pre.session.id, partKey: pre.part.key } },
      create: {
        tenantId, sessionId: pre.session.id, partKey: pre.part.key, treasuryPaymentId: payment.id,
        cashShiftId: pre.cashShiftId, metodoPago: pre.method, cajaBancoId: input.cajaBancoId,
        saleAmount: money(pre.part.saleAmount), reference: input.referencia || null, recordedByUserId: user.id
      },
      update: {}
    });
    if (pre.cashShiftId) await tx.restaurantTableSession.updateMany({ where: { id: pre.session.id, cashShiftId: null }, data: { cashShiftId: pre.cashShiftId } });
    const current = await tx.restaurantTableSession.findFirst({ where: { id: pre.session.id, tenantId }, include: { table: true } });
    const summary = await settlementSummaryInTx(tx, tenantId, current);
    const allPartsPaid = summary.parts.length > 0 && summary.parts.every((part) => part.paid) && money(summary.remaining).eq(0);
    const commercialPaid = summary.sale && summary.sale.estado === 'PAGADO_TOTAL' && money(summary.sale.saldo).eq(0);
    const allPaid = allPartsPaid && commercialPaid;
    if (allPaid && current.state !== 'CERRADA') {
      const closedAt = new Date();
      const closed = await tx.restaurantTableSession.update({ where: { id: current.id }, data: { state: 'CERRADA', closedByUserId: user.id, closedAt } });
      await tx.restaurantTable.update({ where: { id: current.tableId }, data: { state: 'LIBRE' } });
      await tx.restaurantQrVisitDevice.updateMany({ where: { tenantId, sessionId: current.id, revokedAt: null }, data: { revokedAt: closedAt } });
      return settlementSummaryInTx(tx, tenantId, { ...closed, table: current.table });
    }
    return summary;
  });
}

module.exports = {
  visitCode,
  staffVisitStatus,
  rotateVisit,
  authorizeVisit,
  verifyVisit,
  describeVisit,
  changeVisitSeat,
  placeAuthorizedQrOrder,
  preparePaymentPlan,
  paymentSummary,
  registerPartPayment
};