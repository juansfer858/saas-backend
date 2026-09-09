'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const { installOperationalPosMode, operationalStatus } = require('./restaurant-pos-operational-mode');
const identity = require('./restaurant-identity.service');
const paymentMethods = require('./restaurant-payment-methods.service');
const creditPayment = require('./restaurant-credit-payment.service');
const creditCustomers = require('./restaurant-credit-customer.service');
const cashShiftRecovery = require('./restaurant-cash-shift-recovery.service');

// P4 must always execute on the operational POS implementation. This makes DIAN
// an optional external integration and prevents module-load order from restoring
// legacy fiscal gates inside Caja V2.
const base = installOperationalPosMode();

const CASH_V2_MARKER = 'VANTIX_RESTAURANT_V2_CASH_P4';

function decimalString(value) {
  return money(value || 0).toString();
}

function publicShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    cajaBancoId: row.cajaBancoId,
    userId: row.userId,
    estado: row.estado || 'ABIERTA',
    saldoInicial: decimalString(row.saldoInicial),
    ingresosEfectivo: decimalString(row.ingresosEfectivo),
    ingresosVoucher: decimalString(row.ingresosVoucher),
    egresosEfectivo: decimalString(row.egresosEfectivo),
    saldoEsperado: decimalString(row.saldoEsperado),
    saldoFinal: row.saldoFinal == null ? null : decimalString(row.saldoFinal),
    descuadre: row.descuadre == null ? null : decimalString(row.descuadre),
    abiertoEn: row.abiertoEn,
    cerradoEn: row.cerradoEn || null,
    cajaBanco: row.cajaBanco || null,
    user: row.user || null,
    ownedByCurrentUser: Boolean(row.ownedByCurrentUser)
  };
}

function publicMethod(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    cajaBancoId: row.cajaBancoId || null,
    active: row.active !== false,
    sortOrder: row.sortOrder,
    account: row.account ? {
      id: row.account.id,
      tipo: row.account.tipo,
      nombre: row.account.nombre,
      banco: row.account.banco || null,
      numeroCuenta: row.account.numeroCuenta || null,
      activo: row.account.activo !== false
    } : null
  };
}

async function currentRestaurantConfig(tenantId) {
  return prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
}

async function activeSessionForTable(tenantId, tableId) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    include: { table: true },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) throw new AppError(404, 'No hay una cuenta abierta para esta mesa', 'RESTAURANT_V2_CASH_SESSION_NOT_FOUND');
  return session;
}

function assertWholeAccountBoundary(session) {
  const splitMode = String(session?.splitMode || '').toUpperCase();
  const billingMode = String(session?.billingMode || '').toUpperCase();
  const hasPreparedSplit = Boolean(session?.splitMetadata) && splitMode !== 'NONE';
  if (hasPreparedSplit || splitMode === 'BY_ITEM' || splitMode === 'BY_SEAT' || billingMode === 'INDIVIDUAL') {
    throw new AppError(409, 'Esta cuenta requiere División V2. Caja P4 sólo cobra la cuenta completa.', 'RESTAURANT_V2_CASH_SPLIT_REQUIRES_P5');
  }
}

async function saleForSession(tenantId, session, includeDetails = false) {
  const sale = await prisma.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA' },
    include: includeDetails ? { detalles: { orderBy: { id: 'asc' } } } : undefined
  });
  if (!sale) throw new AppError(409, 'La venta de la mesa no está disponible', 'RESTAURANT_V2_CASH_SALE_NOT_FOUND');
  return sale;
}

function publicSale(sale, includeDetails = false) {
  const data = {
    id: sale.id,
    numero: sale.numero,
    estado: sale.estado,
    subtotal: decimalString(sale.subtotal),
    descuentoTotal: decimalString(sale.descuentoTotal),
    ivaTotal: decimalString(sale.ivaTotal),
    impoconsumoTotal: decimalString(sale.impoconsumoTotal),
    total: decimalString(sale.total),
    saldo: decimalString(sale.saldo),
    formaPago: sale.formaPago || null,
    terceroId: sale.terceroId || null
  };
  if (includeDetails) data.items = (sale.detalles || []).map((detail) => ({
    id: detail.id,
    productoId: detail.productoId || null,
    description: detail.descripcion,
    quantity: String(detail.cantidad),
    unitPrice: decimalString(detail.precioUnitario),
    subtotal: decimalString(detail.subtotalLinea),
    iva: decimalString(detail.ivaValor),
    impoconsumo: decimalString(detail.impoconsumoValor),
    total: decimalString(detail.totalLinea)
  }));
  return data;
}

async function workspace(tenantId, user) {
  const [config, methods, shifts, cashAccounts, sessions] = await Promise.all([
    currentRestaurantConfig(tenantId),
    paymentMethods.listMethods(tenantId),
    cashShiftRecovery.cashShiftState(tenantId, user.id),
    prisma.cajaBanco.findMany({
      where: { tenantId, tipo: 'CAJA', activo: true },
      select: { id: true, nombre: true, tipo: true, saldoActual: true },
      orderBy: { nombre: 'asc' }
    }),
    prisma.restaurantTableSession.findMany({
      where: { tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { table: true },
      orderBy: [{ cashierRequestedAt: 'desc' }, { accountRequestedAt: 'desc' }, { openedAt: 'asc' }]
    })
  ]);

  const saleIds = sessions.map((row) => row.saleId);
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA' },
    select: { id: true, numero: true, estado: true, total: true, saldo: true }
  }) : [];
  const saleById = new Map(sales.map((row) => [row.id, row]));

  const queue = sessions.map((session) => {
    const sale = saleById.get(session.saleId) || null;
    const splitMode = String(session.splitMode || '').toUpperCase();
    const requiresP5 = Boolean(session.splitMetadata && splitMode !== 'NONE') || ['BY_ITEM', 'BY_SEAT'].includes(splitMode) || String(session.billingMode || '').toUpperCase() === 'INDIVIDUAL';
    return {
      sessionId: session.id,
      table: { id: session.table.id, code: session.table.code, name: session.table.name },
      state: session.state,
      guestCount: Number(session.guestCount || 1),
      billingMode: session.billingMode || 'CONJUNTA',
      accountRequestedAt: session.accountRequestedAt || null,
      accountPreparedAt: session.accountPreparedAt || null,
      cashierRequestedAt: session.cashierRequestedAt || null,
      readyForCash: Boolean(session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt || session.state === 'CUENTA_PEDIDA'),
      requiresP5,
      sale: sale ? { id: sale.id, numero: sale.numero, estado: sale.estado, total: decimalString(sale.total), saldo: decimalString(sale.saldo) } : null
    };
  }).sort((a, b) => Number(b.readyForCash) - Number(a.readyForCash));

  return {
    marker: CASH_V2_MARKER,
    operation: {
      mode: 'POS_INTERNO',
      electronicInvoiceRequired: false,
      dianRequired: false,
      dianEnabled: Boolean(config.dianRealEnabled),
      status: operationalStatus(config),
      splitOwner: 'P5'
    },
    shift: {
      own: publicShift(shifts.ownShift),
      open: shifts.openShifts.map(publicShift),
      cashAccounts: cashAccounts.map((row) => ({ id: row.id, nombre: row.nombre, tipo: row.tipo, saldoActual: decimalString(row.saldoActual) }))
    },
    paymentMethods: methods.filter((row) => row.active).map(publicMethod),
    queue
  };
}

async function tableDetail(tenantId, user, tableId) {
  const [session, methods, config, shifts] = await Promise.all([
    activeSessionForTable(tenantId, tableId),
    paymentMethods.listMethods(tenantId),
    currentRestaurantConfig(tenantId),
    cashShiftRecovery.cashShiftState(tenantId, user.id)
  ]);
  const sale = await saleForSession(tenantId, session, true);
  const splitMode = String(session.splitMode || '').toUpperCase();
  const requiresP5 = Boolean(session.splitMetadata && splitMode !== 'NONE') || ['BY_ITEM', 'BY_SEAT'].includes(splitMode) || String(session.billingMode || '').toUpperCase() === 'INDIVIDUAL';
  return {
    marker: CASH_V2_MARKER,
    table: { id: session.table.id, code: session.table.code, name: session.table.name },
    session: {
      id: session.id,
      state: session.state,
      guestCount: Number(session.guestCount || 1),
      billingMode: session.billingMode || 'CONJUNTA',
      accountRequestedAt: session.accountRequestedAt || null,
      accountPreparedAt: session.accountPreparedAt || null,
      cashierRequestedAt: session.cashierRequestedAt || null,
      splitMode: session.splitMode || null,
      requiresP5
    },
    sale: publicSale(sale, true),
    shift: { own: publicShift(shifts.ownShift) },
    paymentMethods: methods.filter((row) => row.active).map(publicMethod),
    operation: {
      mode: 'POS_INTERNO',
      electronicInvoiceRequired: false,
      dianRequired: false,
      dianEnabled: Boolean(config.dianRealEnabled),
      splitOwner: 'P5'
    }
  };
}

async function requireOwnShift(tenantId, userId) {
  const shifts = await cashShiftRecovery.cashShiftState(tenantId, userId);
  if (!shifts.ownShift) throw new AppError(409, 'Abra su turno de Caja antes de cobrar', 'RESTAURANT_V2_CASH_SHIFT_REQUIRED');
  return shifts.ownShift;
}

async function openShift(tenantId, user, input) {
  const state = await cashShiftRecovery.cashShiftState(tenantId, user.id);
  if (state.ownShift) throw new AppError(409, 'Ya tienes un turno de Caja abierto', 'RESTAURANT_V2_CASH_SHIFT_ALREADY_OPEN');
  const opened = await base.openCashShift(tenantId, user.id, {
    cajaBancoId: input.cajaBancoId,
    saldoInicial: Number(input.saldoInicial || 0)
  });
  return { marker: CASH_V2_MARKER, shift: publicShift(opened) };
}

async function shiftSummary(tenantId, user) {
  const shift = await requireOwnShift(tenantId, user.id);
  const summary = await base.cashShiftSummary(tenantId, user.id, shift.id);
  return {
    marker: CASH_V2_MARKER,
    shift: publicShift(summary.shift),
    restaurantClosedTablesTotal: decimalString(summary.restaurantClosedTablesTotal),
    systemCashExpected: decimalString(summary.systemCashExpected),
    restaurantCashRecorded: decimalString(summary.restaurantCashRecorded),
    tables: (summary.tables || []).map((row) => ({
      ...row,
      saleTotal: decimalString(row.saleTotal),
      tipAmount: decimalString(row.tipAmount),
      total: decimalString(row.total)
    }))
  };
}

async function closeShift(tenantId, user, input) {
  const shift = await requireOwnShift(tenantId, user.id);
  const result = await base.closeCashShift(tenantId, user.id, shift.id, { saldoFinal: Number(input.saldoFinal || 0) });
  return {
    marker: CASH_V2_MARKER,
    closed: publicShift(result.closed),
    summary: {
      restaurantClosedTablesTotal: decimalString(result.before.restaurantClosedTablesTotal),
      systemCashExpected: decimalString(result.before.systemCashExpected),
      restaurantCashRecorded: decimalString(result.before.restaurantCashRecorded)
    }
  };
}

async function chargeWholeAccount(tenantId, user, tableId, input) {
  const shift = await requireOwnShift(tenantId, user.id);
  const session = await activeSessionForTable(tenantId, tableId);
  assertWholeAccountBoundary(session);
  const sale = await saleForSession(tenantId, session, false);
  if (sale.estado !== 'BORRADOR') throw new AppError(409, 'La cuenta ya fue procesada', 'RESTAURANT_V2_CASH_SALE_ALREADY_PROCESSED');
  if (!money(sale.total).gt(0)) throw new AppError(409, 'La cuenta no tiene saldo para cobrar', 'RESTAURANT_V2_CASH_ZERO_TOTAL');

  const methods = await paymentMethods.listMethods(tenantId);
  const method = methods.find((row) => row.id === input.paymentMethodId && row.active);
  if (!method) throw new AppError(400, 'Seleccione un método de pago activo', 'RESTAURANT_V2_CASH_PAYMENT_METHOD_REQUIRED');

  const reference = String(input.reference || '').trim().slice(0, 160) || null;
  const tipAmount = Number(input.tipAmount || 0);
  if (!Number.isFinite(tipAmount) || tipAmount < 0) throw new AppError(400, 'Propina inválida', 'RESTAURANT_V2_CASH_TIP_INVALID');

  if (method.kind !== 'CREDITO') {
    const result = await paymentMethods.closeTableWithMethod(tenantId, user, tableId, {
      paymentMethodId: method.id,
      reference,
      tipAmount,
      split: { mode: 'NONE' }
    });
    return {
      marker: CASH_V2_MARKER,
      charged: true,
      paymentMethod: publicMethod(method),
      reference,
      credit: null,
      shiftId: shift.id,
      result
    };
  }

  if (tipAmount !== 0) throw new AppError(400, 'El cobro a crédito no admite propina en la misma operación', 'RESTAURANT_V2_CASH_CREDIT_TIP_NOT_ALLOWED');
  const terceroId = String(input.terceroId || '').trim();
  if (!terceroId) throw new AppError(400, 'Selecciona el cliente para crédito', 'RESTAURANT_CREDIT_CUSTOMER_REQUIRED');

  const previousPayment = {
    paymentMethodId: session.paymentMethodId,
    paymentMethodLabel: session.paymentMethodLabel,
    paymentMethodKind: session.paymentMethodKind,
    paymentAccountId: session.paymentAccountId,
    paymentReference: session.paymentReference
  };
  let prepared = null;
  try {
    prepared = await creditPayment.prepareCreditClose(tenantId, tableId, terceroId);
    await prisma.restaurantTableSession.update({
      where: { id: session.id },
      data: {
        paymentMethodId: method.id,
        paymentMethodLabel: method.name,
        paymentMethodKind: method.kind,
        paymentAccountId: null,
        paymentReference: reference
      }
    });
    const result = await identity.closeTableGuarded(tenantId, user, tableId, {
      formaPago: 'CREDITO',
      cajaBancoId: null,
      tipAmount: 0,
      split: { mode: 'NONE' }
    });
    return {
      marker: CASH_V2_MARKER,
      charged: true,
      paymentMethod: publicMethod(method),
      reference,
      credit: prepared.credit,
      customer: prepared.customer,
      shiftId: shift.id,
      result
    };
  } catch (error) {
    if (prepared) await creditPayment.restorePreparedCredit(tenantId, prepared).catch(() => {});
    await prisma.restaurantTableSession.updateMany({
      where: { id: session.id, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      data: previousPayment
    }).catch(() => {});
    throw error;
  }
}

async function listCustomers(tenantId, q) {
  return creditCustomers.listCreditCustomers(tenantId, { q, limit: 100 });
}

async function createCustomer(tenantId, input) {
  return creditCustomers.createCreditCustomer(tenantId, input);
}

module.exports = {
  CASH_V2_MARKER,
  workspace,
  tableDetail,
  openShift,
  shiftSummary,
  closeShift,
  chargeWholeAccount,
  listCustomers,
  createCustomer,
  assertWholeAccountBoundary
};