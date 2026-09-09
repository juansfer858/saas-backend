'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const restaurant = require('./restaurant.service');
const visitPayments = require('./restaurant-visit-payments.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');
const paymentMethods = require('./restaurant-payment-methods.service');
const { installOperationalPosMode, operationalStatus } = require('./restaurant-pos-operational-mode');
const sales = require('../commercial/sales.service');

const SPLIT_V2_MARKER = 'VANTIX_RESTAURANT_V2_SPLIT_P5';
const SPLIT_V2_VERSION = 'RESTAURANT_SPLIT_V2_P5';

// Installs the same POS-internal contract used by Caja V2: Restaurant sales only
// enter DIAN when the tenant explicitly enabled it. Division itself never depends
// on allowSimulatedDocumentEquivalent or a fiscal gate.
installOperationalPosMode();

function decimalString(value) {
  return money(value || 0).toString();
}

function assertStaffTableAccess(user, table) {
  if (user?.rol === 'MESERO' && table.assignedWaiterId && table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa no está asignada a este mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
}

async function activeSession(tx, tenantId, user, tableId) {
  const table = await tx.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  assertStaffTableAccess(user, table);
  const session = await tx.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) throw new AppError(404, 'No hay una cuenta abierta para esta mesa', 'RESTAURANT_V2_SPLIT_SESSION_NOT_FOUND');
  return { table, session };
}

async function finalConsumer(tx, tenantId) {
  return tx.tercero.upsert({
    where: { tenantId_identificacion: { tenantId, identificacion: 'CONSUMIDOR-FINAL-RESTAURANTE' } },
    create: {
      tenantId,
      tipo: 'CLIENTE',
      tipoDocumento: 'OTRO',
      identificacion: 'CONSUMIDOR-FINAL-RESTAURANTE',
      nombre: 'Consumidor final restaurante',
      razonSocial: 'Consumidor final restaurante'
    },
    update: { activo: true, nombre: 'Consumidor final restaurante' }
  });
}

function normalizePlan(computed, mode) {
  const parts = (computed.parts || []).map((part, index) => ({
    key: `P${index + 1}`,
    name: part.name || (mode === 'EQUAL' ? `Persona ${index + 1}` : `Parte ${index + 1}`),
    saleDetailIds: Array.isArray(part.saleDetailIds) ? part.saleDetailIds : [],
    saleAmount: decimalString(part.amount)
  }));
  if (parts.length < 2) throw new AppError(400, 'La división requiere al menos dos partes', 'RESTAURANT_V2_SPLIT_MIN_PARTS');
  return {
    version: SPLIT_V2_VERSION,
    mode,
    total: decimalString(computed.total),
    parts
  };
}

async function buildPlan(tx, tenantId, session, sale, input) {
  const mode = String(input.mode || '').toUpperCase();
  if (mode === 'EQUAL') {
    const count = Math.max(Number(input.parts || session.guestCount || 2), 2);
    return normalizePlan(restaurant.computeSplit(sale, 0, { mode: 'EQUAL', parts: count }), 'EQUAL');
  }
  if (mode === 'BY_ITEM') {
    return normalizePlan(restaurant.computeSplit(sale, 0, { mode: 'BY_ITEM', assignments: input.assignments || [] }), 'BY_ITEM');
  }
  if (mode === 'BY_SEAT') {
    const orderIds = (await tx.restaurantOrder.findMany({
      where: { tenantId, sessionId: session.id, state: { not: 'CANCELADO' } },
      select: { id: true }
    })).map((row) => row.id);
    const items = orderIds.length ? await tx.restaurantOrderItem.findMany({
      where: { tenantId, orderId: { in: orderIds } },
      select: { saleDetailId: true, seatNumber: true }
    }) : [];
    const bySeat = new Map();
    for (const item of items) {
      const seat = Number(item.seatNumber || 0);
      if (!item.saleDetailId || !Number.isInteger(seat) || seat < 1 || seat > Number(session.guestCount || 1)) {
        throw new AppError(409, 'Hay productos sin persona asignada. Usa Productos / personas o Partes iguales.', 'RESTAURANT_V2_SPLIT_UNASSIGNED_ITEMS');
      }
      if (!bySeat.has(seat)) bySeat.set(seat, []);
      bySeat.get(seat).push(item.saleDetailId);
    }
    if (bySeat.size < 2) throw new AppError(409, 'Se requieren consumos asignados al menos a dos personas', 'RESTAURANT_V2_SPLIT_SEATS_INCOMPLETE');
    const assignments = [...bySeat.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, saleDetailIds]) => ({ name: `Persona ${seat}`, saleDetailIds: [...new Set(saleDetailIds)] }));
    const computed = restaurant.computeSplit(sale, 0, { mode: 'BY_ITEM', assignments });
    return normalizePlan(computed, 'BY_SEAT');
  }
  throw new AppError(400, 'Modo de división inválido', 'RESTAURANT_V2_SPLIT_MODE_INVALID');
}

async function seatMapForSession(tenantId, sessionId) {
  const orderIds = (await prisma.restaurantOrder.findMany({
    where: { tenantId, sessionId, state: { not: 'CANCELADO' } },
    select: { id: true }
  })).map((row) => row.id);
  if (!orderIds.length) return new Map();
  const rows = await prisma.restaurantOrderItem.findMany({
    where: { tenantId, orderId: { in: orderIds } },
    select: { saleDetailId: true, seatNumber: true }
  });
  const map = new Map();
  for (const row of rows) if (row.saleDetailId) map.set(row.saleDetailId, Number(row.seatNumber || 0) || null);
  return map;
}

async function methodsForSplit(tenantId) {
  const methods = await paymentMethods.listMethods(tenantId);
  return methods.filter((row) => row.active && ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'].includes(row.kind)).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    cajaBancoId: row.cajaBancoId,
    account: row.account ? {
      id: row.account.id,
      tipo: row.account.tipo,
      nombre: row.account.nombre,
      banco: row.account.banco || null,
      numeroCuenta: row.account.numeroCuenta || null
    } : null
  }));
}

async function detailSummary(tenantId, user, tableId) {
  const summary = await visitPayments.paymentSummary(tenantId, user, tableId);
  const methods = await methodsForSplit(tenantId);
  if (!summary.sale) return { marker: SPLIT_V2_MARKER, ...summary, paymentMethods: methods, items: [], operation: { mode: 'POS_INTERNO', dianRequired: false } };
  const [sale, config, seatMap] = await Promise.all([
    prisma.comprobanteComercial.findFirst({
      where: { id: summary.sale.id, tenantId },
      include: { detalles: { orderBy: { id: 'asc' } } }
    }),
    prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} }),
    seatMapForSession(tenantId, summary.sessionId)
  ]);
  const detailById = new Map((sale?.detalles || []).map((row) => [row.id, row]));
  const items = (sale?.detalles || []).map((row) => ({
    id: row.id,
    description: row.descripcion,
    quantity: String(row.cantidad),
    unitPrice: decimalString(row.precioUnitario),
    total: decimalString(row.totalLinea),
    seatNumber: seatMap.get(row.id) || null
  }));
  const parts = (summary.parts || []).map((part) => ({
    ...part,
    items: (part.saleDetailIds || []).map((id) => detailById.get(id)).filter(Boolean).map((row) => ({
      id: row.id,
      description: row.descripcion,
      quantity: String(row.cantidad),
      total: decimalString(row.totalLinea)
    }))
  }));
  return {
    marker: SPLIT_V2_MARKER,
    ...summary,
    parts,
    items,
    paymentMethods: methods,
    operation: {
      mode: 'POS_INTERNO',
      dianRequired: false,
      electronicInvoiceRequired: false,
      dianEnabled: Boolean(config.dianRealEnabled),
      status: operationalStatus(config)
    }
  };
}

async function workspace(tenantId, user) {
  const sessions = await prisma.restaurantTableSession.findMany({
    where: { tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true },
    orderBy: [{ cashierRequestedAt: 'desc' }, { accountRequestedAt: 'desc' }, { openedAt: 'asc' }]
  });
  const saleIds = sessions.map((row) => row.saleId);
  const salesRows = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds } },
    select: { id: true, numero: true, total: true, saldo: true, estado: true }
  }) : [];
  const saleById = new Map(salesRows.map((row) => [row.id, row]));
  const rows = [];
  for (const session of sessions) {
    assertStaffTableAccess(user, session.table);
    const sale = saleById.get(session.saleId);
    const plan = session.splitMetadata && typeof session.splitMetadata === 'object' ? session.splitMetadata : null;
    const paidCount = plan ? await prisma.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } }) : 0;
    rows.push({
      table: { id: session.table.id, code: session.table.code, name: session.table.name },
      sessionId: session.id,
      state: session.state,
      guestCount: Number(session.guestCount || 1),
      billingMode: session.billingMode || 'CONJUNTA',
      prepared: Boolean(plan),
      splitMode: plan?.mode || null,
      parts: Array.isArray(plan?.parts) ? plan.parts.length : 0,
      paidParts: paidCount,
      accountRequestedAt: session.accountRequestedAt || null,
      sale: sale ? { id: sale.id, numero: sale.numero, estado: sale.estado, total: decimalString(sale.total), saldo: decimalString(sale.saldo) } : null
    });
  }
  return { marker: SPLIT_V2_MARKER, rows, paymentMethods: await methodsForSplit(tenantId) };
}

async function prepare(tenantId, user, tableId, input) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const { table, session } = await activeSession(tx, tenantId, user, tableId);
      if (session.splitMetadata) return { existing: true, sessionId: session.id };
      const sale = await tx.comprobanteComercial.findFirst({
        where: { id: session.saleId, tenantId, estado: 'BORRADOR' },
        include: { detalles: true }
      });
      if (!sale || !sale.detalles.length) throw new AppError(409, 'La mesa no tiene consumos disponibles para dividir', 'RESTAURANT_V2_SPLIT_EMPTY');
      const plan = await buildPlan(tx, tenantId, session, sale, input);
      const consumer = await finalConsumer(tx, tenantId);

      // The commercial document is emitted as a receivable once. Each part payment
      // then amortizes that same real CXC, so mixed cash/bank/card payments remain
      // accounting-safe without fabricating independent sales.
      await tx.comprobanteComercial.update({
        where: { id: sale.id },
        data: { terceroId: consumer.id, formaPago: 'CREDITO', cajaBancoId: null }
      });
      const emitted = await sales.emitSaleInTx(tx, tenantId, user.id, sale.id, 'DOCUMENTO_EQUIVALENTE_POS');
      const now = new Date();
      await tx.restaurantTableSession.update({
        where: { id: session.id },
        data: {
          state: 'CUENTA_PEDIDA',
          accountPreparedAt: now,
          cashierRequestedAt: now,
          accountRequestedAt: session.accountRequestedAt || now,
          splitMode: plan.mode,
          splitMetadata: { ...plan, preparedAt: now.toISOString(), preparedByUserId: user.id, operationalPos: true },
          tipAmount: 0
        }
      });
      await tx.restaurantTable.update({ where: { id: table.id }, data: { state: 'CUENTA_PEDIDA' } });
      await tx.restaurantQrVisitDevice.updateMany({ where: { tenantId, sessionId: session.id, revokedAt: null }, data: { revokedAt: now } });
      return { existing: false, sessionId: session.id, saleId: emitted.id };
    });
    return { ...(await detailSummary(tenantId, user, tableId)), existingPlan: result.existing };
  } catch (error) {
    // A concurrent prepare may have emitted the same sale first. If the committed
    // session now contains the split plan, treat this as an idempotent prepare.
    if (['SALE_NOT_DRAFT', 'P2002'].includes(error?.code)) {
      const summary = await detailSummary(tenantId, user, tableId).catch(() => null);
      if (summary?.prepared) return { ...summary, existingPlan: true };
    }
    throw error;
  }
}

async function payPart(tenantId, user, tableId, input) {
  const methods = await methodsForSplit(tenantId);
  const method = methods.find((row) => row.id === input.paymentMethodId);
  if (!method || !method.cajaBancoId) throw new AppError(400, 'Selecciona un método de pago disponible', 'RESTAURANT_V2_SPLIT_PAYMENT_METHOD_REQUIRED');
  const before = await visitPayments.paymentSummary(tenantId, user, tableId);
  if (!before.prepared) throw new AppError(409, 'Primero prepara la división', 'RESTAURANT_V2_SPLIT_NOT_PREPARED');
  const part = before.parts.find((row) => row.key === input.partKey);
  if (!part) throw new AppError(404, 'Parte no encontrada', 'RESTAURANT_V2_SPLIT_PART_NOT_FOUND');
  if (part.paid) return detailSummary(tenantId, user, tableId);

  const userReference = String(input.reference || '').trim();
  const reference = `${method.name}${userReference ? ` · ${userReference}` : ''}`.slice(0, 160);
  await settlementFinalizer.registerPartPaymentFinalized(tenantId, user, tableId, {
    partKey: input.partKey,
    metodoPago: method.kind,
    cajaBancoId: method.cajaBancoId,
    referencia: reference
  });
  return detailSummary(tenantId, user, tableId);
}

module.exports = {
  SPLIT_V2_MARKER,
  SPLIT_V2_VERSION,
  workspace,
  detailSummary,
  prepare,
  payPart,
  buildPlan,
  methodsForSplit
};