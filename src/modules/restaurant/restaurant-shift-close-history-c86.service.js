'use strict';

const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const { AppError } = require('../../utils/app-error');
const { toExcelHtml, toSimplePdf } = require('../accounting/accounting-export.service');
const posReceiptPrint = require('./restaurant-pos-receipt-print.service');

const MARKER = 'VANTIX_RESTAURANT_SHIFT_CLOSE_HISTORY_C86';
const VERSION = '86.0.0';
const AUDIT_ENTITY = 'RESTAURANT_SHIFT_CLOSE_C86';
const SNAPSHOT_ACTION = 'RESTAURANT_SHIFT_CLOSE_SNAPSHOT';
const PRINT_ACTION = 'PRINT_SHIFT_CLOSE';
const CHANNELS = Object.freeze(['MESAS', 'MOSTRADOR', 'DOMICILIOS', 'PARA_LLEVAR']);
const STATIONS = Object.freeze(['COCINA', 'BARRA', 'POSTRES']);
const DEFAULT_TZ_OFFSET_MINUTES = 300;

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyString(value) {
  return money(value || 0).toString();
}

function qtyString(value) {
  const n = number(value);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TZ_OFFSET_MINUTES;
  return Math.min(Math.max(Math.trunc(parsed), -840), 840);
}

function businessDate(value, tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const localMs = date.getTime() - normalizeOffset(tzOffsetMinutes) * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function classifyTableChannel(table) {
  const value = `${table?.code || ''} ${table?.name || ''}`.trim().toUpperCase();
  if (/(MOSTRADOR|COUNTER|BARRA RAPIDA|CAJA RAPIDA)/.test(value)) return 'MOSTRADOR';
  if (/(PARA[ _-]?LLEVAR|LLEVAR|TAKE[ _-]?AWAY|TAKE[ _-]?OUT)/.test(value)) return 'PARA_LLEVAR';
  return 'MESAS';
}

function emptyChannel(key) {
  return {
    key,
    tickets: 0,
    deliveredItems: '0',
    kitchenItems: '0',
    productionValue: '0.00',
    billedValue: '0.00',
    tips: '0.00',
    expectedSettlement: '0.00',
    settledValue: '0.00',
    difference: '0.00'
  };
}

function emptyProduction(station) {
  return { station, commands: 0, deliveredItems: '0', value: '0.00', readyNotDelivered: 0 };
}

function makeAccumulator() {
  return {
    tickets: 0,
    deliveredItems: decimal(0),
    kitchenItems: decimal(0),
    productionValue: decimal(0),
    billedValue: decimal(0),
    tips: decimal(0),
    expectedSettlement: decimal(0),
    settledValue: decimal(0)
  };
}

function finishAccumulator(key, row) {
  return {
    key,
    tickets: row.tickets,
    deliveredItems: qtyString(row.deliveredItems),
    kitchenItems: qtyString(row.kitchenItems),
    productionValue: moneyString(row.productionValue),
    billedValue: moneyString(row.billedValue),
    tips: moneyString(row.tips),
    expectedSettlement: moneyString(row.expectedSettlement),
    settledValue: moneyString(row.settledValue),
    difference: moneyString(decimal(row.expectedSettlement).minus(row.settledValue))
  };
}

function paymentBucket() {
  return { EFECTIVO: decimal(0), TRANSFERENCIA: decimal(0), TARJETA: decimal(0), CREDITO: decimal(0), OTROS: decimal(0) };
}

function addPayment(bucket, kind, value) {
  const normalized = String(kind || '').trim().toUpperCase();
  if (normalized === 'EFECTIVO') bucket.EFECTIVO = bucket.EFECTIVO.plus(value || 0);
  else if (normalized === 'TRANSFERENCIA') bucket.TRANSFERENCIA = bucket.TRANSFERENCIA.plus(value || 0);
  else if (normalized === 'TARJETA') bucket.TARJETA = bucket.TARJETA.plus(value || 0);
  else if (normalized === 'CREDITO') bucket.CREDITO = bucket.CREDITO.plus(value || 0);
  else bucket.OTROS = bucket.OTROS.plus(value || 0);
}

function finishPayments(bucket) {
  const total = Object.values(bucket).reduce((sum, value) => sum.plus(value), decimal(0));
  return {
    cash: moneyString(bucket.EFECTIVO),
    transfer: moneyString(bucket.TRANSFERENCIA),
    card: moneyString(bucket.TARJETA),
    credit: moneyString(bucket.CREDITO),
    other: moneyString(bucket.OTROS),
    total: moneyString(total)
  };
}

function commandItems(order, command) {
  return (order?.items || []).filter((item) => String(item.station) === String(command?.station));
}

function productionForOrders(orders, saleDetailIds, reference, exceptions, productionAcc) {
  let deliveredItems = decimal(0);
  let kitchenItems = decimal(0);
  let deliveredValue = decimal(0);
  const deliveredDetailIds = new Set();
  const billedOrderDetailIds = new Set();

  for (const order of orders || []) {
    for (const item of order.items || []) billedOrderDetailIds.add(item.saleDetailId);
    for (const command of order.commands || []) {
      const station = String(command.station || '').toUpperCase();
      const stationRow = productionAcc[station];
      if (!stationRow) continue;
      const items = commandItems(order, command);
      if (command.state === 'ENTREGADA') {
        stationRow.commands += 1;
        for (const item of items) {
          const quantity = decimal(item.quantity || 0);
          const lineValue = decimal(item.lineTotal || 0);
          stationRow.deliveredItems = stationRow.deliveredItems.plus(quantity);
          stationRow.value = stationRow.value.plus(lineValue);
          deliveredItems = deliveredItems.plus(quantity);
          deliveredValue = deliveredValue.plus(lineValue);
          if (station === 'COCINA') kitchenItems = kitchenItems.plus(quantity);
          deliveredDetailIds.add(item.saleDetailId);
          if (!saleDetailIds.has(item.saleDetailId)) {
            exceptions.push({
              type: 'SALIDA_SIN_LINEA_DE_VENTA',
              severity: 'HIGH',
              reference,
              station,
              item: item.description,
              quantity: qtyString(item.quantity),
              value: moneyString(item.lineTotal),
              at: iso(command.deliveredAt || command.actualizadoEn)
            });
          }
        }
      } else if (['PENDIENTE', 'EN_PREPARACION', 'LISTA'].includes(String(command.state))) {
        stationRow.readyNotDelivered += 1;
        exceptions.push({
          type: 'CUENTA_CERRADA_CON_PRODUCCION_PENDIENTE',
          severity: 'MEDIUM',
          reference,
          station,
          state: command.state,
          at: iso(command.readyAt || command.startedAt || command.creadoEn)
        });
      }
    }
  }

  for (const detailId of billedOrderDetailIds) {
    if (saleDetailIds.has(detailId) && !deliveredDetailIds.has(detailId)) {
      exceptions.push({
        type: 'LINEA_COBRADA_SIN_ENTREGA_CONFIRMADA',
        severity: 'MEDIUM',
        reference,
        saleDetailId: detailId
      });
    }
  }

  return { deliveredItems, kitchenItems, deliveredValue };
}

function movementView(row) {
  return {
    id: row.id,
    type: row.tipo,
    amount: moneyString(row.monto),
    reference: row.referencia || null,
    concept: row.concepto || null,
    at: iso(row.creadoEn)
  };
}

async function buildSnapshot(tenantId, shiftId, options = {}, client = prisma) {
  const base = await posReceiptPrint.buildCashCloseSnapshot(tenantId, shiftId, client);
  if (!base?.shift?.id) throw new AppError(404, 'Cierre de turno no encontrado', 'RESTAURANT_SHIFT_CLOSE_NOT_FOUND');

  const offset = normalizeOffset(options.tzOffsetMinutes);
  const openedAt = new Date(base.shift.abiertoEn);
  const closedAt = new Date(base.shift.cerradoEn || Date.now());

  const sessions = await client.restaurantTableSession.findMany({
    where: { tenantId, cashShiftId: shiftId, state: 'CERRADA' },
    include: {
      table: true,
      sessionPayments: { orderBy: { paidAt: 'asc' } },
      orders: {
        include: { items: true, commands: true },
        orderBy: { creadoEn: 'asc' }
      }
    },
    orderBy: { closedAt: 'asc' }
  });

  const deliveryRows = await client.restaurantDeliveryOrder.findMany({
    where: {
      tenantId,
      OR: [
        { creadoEn: { gte: openedAt, lte: closedAt } },
        { deliveredAt: { gte: openedAt, lte: closedAt } },
        { actualizadoEn: { gte: openedAt, lte: closedAt } }
      ]
    },
    include: { items: true, commands: true },
    orderBy: { creadoEn: 'asc' }
  });

  const saleIds = [...new Set([
    ...sessions.map((row) => row.saleId),
    ...deliveryRows.map((row) => row.saleId)
  ].filter(Boolean))];
  const sales = saleIds.length ? await client.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA' },
    include: { detalles: { orderBy: { id: 'asc' } } }
  }) : [];
  const saleById = new Map(sales.map((row) => [row.id, row]));

  const userIds = [...new Set([
    ...sessions.flatMap((row) => [row.closedByUserId, row.openedByUserId]),
    ...deliveryRows.flatMap((row) => [row.createdByUserId, row.acceptedByUserId])
  ].filter(Boolean))];
  const users = userIds.length ? await client.user.findMany({
    where: { tenantId, id: { in: userIds } },
    select: { id: true, nombre: true, email: true, rol: true }
  }) : [];
  const userById = new Map(users.map((row) => [row.id, row]));

  const movements = await client.movimientoTesoreria.findMany({
    where: {
      tenantId,
      cajaBancoId: base.shift.cajaBancoId,
      creadoEn: { gte: openedAt, lte: closedAt }
    },
    orderBy: { creadoEn: 'asc' }
  });

  const channelAcc = Object.fromEntries(CHANNELS.map((key) => [key, makeAccumulator()]));
  const productionAcc = Object.fromEntries(STATIONS.map((key) => [key, { commands: 0, deliveredItems: decimal(0), value: decimal(0), readyNotDelivered: 0 }]));
  const payments = paymentBucket();
  const operations = [];
  const exceptions = [];

  for (const session of sessions) {
    const sale = saleById.get(session.saleId);
    if (!sale || sale.estado === 'ANULADO') continue;
    const channel = classifyTableChannel(session.table);
    const acc = channelAcc[channel];
    const detailIds = new Set((sale.detalles || []).map((row) => row.id));
    const reference = session.table?.name || session.table?.code || `Mesa ${session.id.slice(0, 6)}`;
    const production = productionForOrders(session.orders, detailIds, reference, exceptions, productionAcc);
    const billed = decimal(sale.total || 0);
    const tip = decimal(session.tipAmount || 0);
    const expected = billed.plus(tip);
    const collected = expected;
    const firstOrder = (session.orders || [])[0]?.creadoEn || null;
    const collector = userById.get(session.closedByUserId);

    acc.tickets += 1;
    acc.deliveredItems = acc.deliveredItems.plus(production.deliveredItems);
    acc.kitchenItems = acc.kitchenItems.plus(production.kitchenItems);
    acc.productionValue = acc.productionValue.plus(production.deliveredValue);
    acc.billedValue = acc.billedValue.plus(billed);
    acc.tips = acc.tips.plus(tip);
    acc.expectedSettlement = acc.expectedSettlement.plus(expected);
    acc.settledValue = acc.settledValue.plus(collected);

    if (session.sessionPayments?.length) {
      for (const payment of session.sessionPayments) addPayment(payments, payment.metodoPago, payment.saleAmount);
      const paid = (session.sessionPayments || []).reduce((sum, row) => sum.plus(row.saleAmount || 0), decimal(0));
      const remainder = expected.minus(paid);
      if (remainder.gt(0) && String(session.paymentMethodKind || '').toUpperCase() === 'CREDITO') addPayment(payments, 'CREDITO', remainder);
      else if (remainder.gt(0)) addPayment(payments, session.paymentMethodKind || sale.formaPago, remainder);
    } else {
      addPayment(payments, session.paymentMethodKind || sale.formaPago, expected);
    }

    operations.push({
      channel,
      id: session.id,
      reference,
      saleNumber: sale.numero || null,
      openedAt: iso(session.openedAt),
      orderAt: iso(firstOrder),
      accountAt: iso(session.cashierRequestedAt || session.accountRequestedAt || session.accountPreparedAt),
      collectedAt: iso(session.closedAt),
      collectedBy: collector?.nombre || collector?.email || null,
      billedValue: moneyString(billed),
      tips: moneyString(tip),
      collectedValue: moneyString(collected),
      paymentMethod: session.paymentMethodLabel || session.paymentMethodKind || sale.formaPago || null,
      deliveredItems: qtyString(production.deliveredItems),
      kitchenItems: qtyString(production.kitchenItems),
      state: 'COBRADA'
    });
  }

  for (const order of deliveryRows) {
    if (order.state === 'CANCELADO') continue;
    const sale = saleById.get(order.saleId);
    const detailIds = new Set((sale?.detalles || []).map((row) => row.id));
    const reference = order.code || `Domicilio ${order.id.slice(0, 6)}`;
    const production = productionForOrders([{ items: order.items || [], commands: order.commands || [] }], detailIds, reference, exceptions, productionAcc);
    const billed = decimal(sale?.total ?? order.total ?? 0);
    const paid = order.paymentStatus === 'PAGADO';
    const settled = paid ? billed : decimal(0);
    const acc = channelAcc.DOMICILIOS;

    acc.tickets += 1;
    acc.deliveredItems = acc.deliveredItems.plus(production.deliveredItems);
    acc.kitchenItems = acc.kitchenItems.plus(production.kitchenItems);
    acc.productionValue = acc.productionValue.plus(production.deliveredValue);
    acc.billedValue = acc.billedValue.plus(billed);
    acc.expectedSettlement = acc.expectedSettlement.plus(billed);
    acc.settledValue = acc.settledValue.plus(settled);

    if (paid) addPayment(payments, order.paymentMethod, billed);
    if (order.state === 'ENTREGADO' && !paid) {
      exceptions.push({
        type: 'DOMICILIO_ENTREGADO_SIN_RECAUDO',
        severity: 'HIGH',
        reference,
        value: moneyString(billed),
        at: iso(order.deliveredAt)
      });
    }

    operations.push({
      channel: 'DOMICILIOS',
      id: order.id,
      reference,
      saleNumber: sale?.numero || null,
      openedAt: iso(order.creadoEn),
      orderAt: iso(order.creadoEn),
      accountAt: null,
      collectedAt: paid ? iso(order.actualizadoEn) : null,
      collectedBy: null,
      billedValue: moneyString(billed),
      tips: '0.00',
      collectedValue: moneyString(settled),
      paymentMethod: order.paymentMethod || null,
      deliveredItems: qtyString(production.deliveredItems),
      kitchenItems: qtyString(production.kitchenItems),
      state: order.state === 'ENTREGADO' ? (paid ? 'COBRADA' : 'PENDIENTE_RECAUDO') : order.state
    });
  }

  const channels = Object.fromEntries(CHANNELS.map((key) => [key, finishAccumulator(key, channelAcc[key])]));
  const totalsAcc = CHANNELS.reduce((acc, key) => {
    const row = channelAcc[key];
    acc.tickets += row.tickets;
    acc.deliveredItems = acc.deliveredItems.plus(row.deliveredItems);
    acc.kitchenItems = acc.kitchenItems.plus(row.kitchenItems);
    acc.productionValue = acc.productionValue.plus(row.productionValue);
    acc.billedValue = acc.billedValue.plus(row.billedValue);
    acc.tips = acc.tips.plus(row.tips);
    acc.expectedSettlement = acc.expectedSettlement.plus(row.expectedSettlement);
    acc.settledValue = acc.settledValue.plus(row.settledValue);
    return acc;
  }, makeAccumulator());
  const totals = finishAccumulator('TOTAL', totalsAcc);

  const production = Object.fromEntries(STATIONS.map((station) => {
    const row = productionAcc[station];
    return [station, {
      station,
      commands: row.commands,
      deliveredItems: qtyString(row.deliveredItems),
      value: moneyString(row.value),
      readyNotDelivered: row.readyNotDelivered
    }];
  }));

  const cashDifference = decimal(base.shift.descuadre || 0);
  const operationDifference = decimal(totals.difference || 0);
  const status = exceptions.some((row) => row.severity === 'HIGH') || !cashDifference.eq(0) || !operationDifference.eq(0)
    ? 'REVISAR'
    : 'CUADRADO';

  return {
    marker: MARKER,
    version: VERSION,
    immutable: true,
    shift: base.shift,
    businessDate: businessDate(base.shift.abiertoEn, offset),
    timezoneOffsetMinutes: offset,
    status,
    channels,
    totals: {
      ...totals,
      accountsCharged: operations.filter((row) => row.state === 'COBRADA').length,
      kitchenDeliveredItems: production.COCINA.deliveredItems
    },
    production,
    payments: finishPayments(payments),
    cash: {
      openingBalance: moneyString(base.shift.saldoInicial),
      cashIncome: moneyString(base.shift.ingresosEfectivo),
      voucherIncome: moneyString(base.shift.ingresosVoucher),
      cashOut: moneyString(base.shift.egresosEfectivo),
      expectedCash: moneyString(base.systemCashExpected),
      countedCash: moneyString(base.shift.saldoFinal),
      difference: moneyString(base.shift.descuadre)
    },
    movements: movements.map(movementView),
    operations,
    exceptions,
    generatedAt: new Date().toISOString()
  };
}

function snapshotFromAudit(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const snapshot = metadata.snapshot;
  return snapshot?.marker === MARKER && snapshot?.shift?.id ? snapshot : null;
}

async function findSnapshotRow(tenantId, shiftId, client = prisma) {
  return client.auditoriaContable.findFirst({
    where: { tenantId, entidad: AUDIT_ENTITY, entidadId: shiftId, accion: SNAPSHOT_ACTION },
    orderBy: { creadoEn: 'desc' }
  });
}

async function ensureSnapshot(tenantId, userId, shiftId, options = {}, client = prisma) {
  const existing = await findSnapshotRow(tenantId, shiftId, client);
  const previous = snapshotFromAudit(existing);
  if (previous) return previous;
  const snapshot = await buildSnapshot(tenantId, shiftId, options, client);
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: AUDIT_ENTITY,
      entidadId: shiftId,
      accion: SNAPSHOT_ACTION,
      metadata: { marker: MARKER, version: VERSION, label: 'Cierre de turno guardado', snapshot }
    }
  });
  return snapshot;
}

function previewFromShift(row, tzOffsetMinutes) {
  return {
    shiftId: row.id,
    businessDate: businessDate(row.abiertoEn, tzOffsetMinutes),
    openedAt: iso(row.abiertoEn),
    closedAt: iso(row.cerradoEn),
    caja: row.cajaBanco?.nombre || 'Caja',
    cashier: row.user?.nombre || row.user?.email || 'Usuario',
    billedValue: moneyString(decimal(row.ingresosEfectivo || 0).plus(row.ingresosVoucher || 0)),
    settledValue: moneyString(decimal(row.ingresosEfectivo || 0).plus(row.ingresosVoucher || 0)),
    difference: moneyString(row.descuadre),
    status: decimal(row.descuadre || 0).eq(0) ? 'CUADRADO' : 'REVISAR',
    persisted: false
  };
}

function previewFromSnapshot(snapshot) {
  return {
    shiftId: snapshot.shift.id,
    businessDate: snapshot.businessDate,
    openedAt: snapshot.shift.abiertoEn,
    closedAt: snapshot.shift.cerradoEn,
    caja: snapshot.shift.cajaNombre || 'Caja',
    cashier: snapshot.shift.cajero || 'Usuario',
    billedValue: snapshot.totals.billedValue,
    settledValue: snapshot.totals.settledValue,
    difference: snapshot.totals.difference,
    cashDifference: snapshot.cash.difference,
    status: snapshot.status,
    persisted: true
  };
}

function dateAllowed(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function dayRows(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.businessDate;
    if (!key) continue;
    if (!map.has(key)) map.set(key, { businessDate: key, shifts: 0, billedValue: decimal(0), settledValue: decimal(0), difference: decimal(0), status: 'CUADRADO' });
    const row = map.get(key);
    row.shifts += 1;
    row.billedValue = row.billedValue.plus(item.billedValue || 0);
    row.settledValue = row.settledValue.plus(item.settledValue || 0);
    row.difference = row.difference.plus(item.difference || 0);
    if (item.status === 'REVISAR') row.status = 'REVISAR';
  }
  return [...map.values()].map((row) => ({
    businessDate: row.businessDate,
    shifts: row.shifts,
    billedValue: moneyString(row.billedValue),
    settledValue: moneyString(row.settledValue),
    difference: moneyString(row.difference),
    status: row.status
  })).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
}

async function listClosures(tenantId, options = {}, client = prisma) {
  const offset = normalizeOffset(options.tzOffsetMinutes);
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);
  const auditRows = await client.auditoriaContable.findMany({
    where: { tenantId, entidad: AUDIT_ENTITY, accion: SNAPSHOT_ACTION },
    orderBy: { creadoEn: 'desc' },
    take: 1000
  });
  const byShift = new Map();
  for (const row of auditRows) {
    const snapshot = snapshotFromAudit(row);
    if (snapshot && !byShift.has(snapshot.shift.id)) byShift.set(snapshot.shift.id, previewFromSnapshot(snapshot));
  }

  const shifts = await client.aperturaCierreCaja.findMany({
    where: { tenantId, estado: 'CERRADA' },
    include: {
      cajaBanco: { select: { id: true, nombre: true } },
      user: { select: { id: true, nombre: true, email: true } }
    },
    orderBy: { cerradoEn: 'desc' },
    take: 1000
  });
  for (const shift of shifts) if (!byShift.has(shift.id)) byShift.set(shift.id, previewFromShift(shift, offset));

  const from = String(options.from || '').slice(0, 10) || null;
  const to = String(options.to || '').slice(0, 10) || null;
  const items = [...byShift.values()]
    .filter((row) => dateAllowed(row.businessDate, from, to))
    .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')))
    .slice(0, limit);

  return { marker: MARKER, version: VERSION, immutableHistory: true, items, days: dayRows(items) };
}

async function getClosure(tenantId, userId, shiftId, options = {}, client = prisma) {
  return ensureSnapshot(tenantId, userId, shiftId, options, client);
}

function addFinishedChannels(target, snapshot) {
  for (const key of CHANNELS) {
    const source = snapshot.channels?.[key] || emptyChannel(key);
    const dest = target[key];
    dest.tickets += Number(source.tickets || 0);
    dest.deliveredItems = dest.deliveredItems.plus(source.deliveredItems || 0);
    dest.kitchenItems = dest.kitchenItems.plus(source.kitchenItems || 0);
    dest.productionValue = dest.productionValue.plus(source.productionValue || 0);
    dest.billedValue = dest.billedValue.plus(source.billedValue || 0);
    dest.tips = dest.tips.plus(source.tips || 0);
    dest.expectedSettlement = dest.expectedSettlement.plus(source.expectedSettlement || 0);
    dest.settledValue = dest.settledValue.plus(source.settledValue || 0);
  }
}

function aggregateSnapshots(snapshots, date) {
  const channelsAcc = Object.fromEntries(CHANNELS.map((key) => [key, makeAccumulator()]));
  const productionAcc = Object.fromEntries(STATIONS.map((key) => [key, { commands: 0, deliveredItems: decimal(0), value: decimal(0), readyNotDelivered: 0 }]));
  const paymentAcc = paymentBucket();
  let cashOpening = decimal(0); let cashIncome = decimal(0); let voucherIncome = decimal(0); let cashOut = decimal(0); let expectedCash = decimal(0); let countedCash = decimal(0); let cashDiff = decimal(0);
  const operations = []; const movements = []; const exceptions = [];

  for (const snapshot of snapshots) {
    addFinishedChannels(channelsAcc, snapshot);
    for (const station of STATIONS) {
      const src = snapshot.production?.[station] || emptyProduction(station);
      const dst = productionAcc[station];
      dst.commands += Number(src.commands || 0);
      dst.deliveredItems = dst.deliveredItems.plus(src.deliveredItems || 0);
      dst.value = dst.value.plus(src.value || 0);
      dst.readyNotDelivered += Number(src.readyNotDelivered || 0);
    }
    addPayment(paymentAcc, 'EFECTIVO', snapshot.payments?.cash || 0);
    addPayment(paymentAcc, 'TRANSFERENCIA', snapshot.payments?.transfer || 0);
    addPayment(paymentAcc, 'TARJETA', snapshot.payments?.card || 0);
    addPayment(paymentAcc, 'CREDITO', snapshot.payments?.credit || 0);
    addPayment(paymentAcc, 'OTROS', snapshot.payments?.other || 0);
    cashOpening = cashOpening.plus(snapshot.cash?.openingBalance || 0);
    cashIncome = cashIncome.plus(snapshot.cash?.cashIncome || 0);
    voucherIncome = voucherIncome.plus(snapshot.cash?.voucherIncome || 0);
    cashOut = cashOut.plus(snapshot.cash?.cashOut || 0);
    expectedCash = expectedCash.plus(snapshot.cash?.expectedCash || 0);
    countedCash = countedCash.plus(snapshot.cash?.countedCash || 0);
    cashDiff = cashDiff.plus(snapshot.cash?.difference || 0);
    operations.push(...(snapshot.operations || []).map((row) => ({ ...row, shiftId: snapshot.shift.id })));
    movements.push(...(snapshot.movements || []).map((row) => ({ ...row, shiftId: snapshot.shift.id })));
    exceptions.push(...(snapshot.exceptions || []).map((row) => ({ ...row, shiftId: snapshot.shift.id })));
  }

  const channels = Object.fromEntries(CHANNELS.map((key) => [key, finishAccumulator(key, channelsAcc[key])]));
  const totalsAcc = CHANNELS.reduce((acc, key) => {
    const row = channelsAcc[key];
    acc.tickets += row.tickets;
    acc.deliveredItems = acc.deliveredItems.plus(row.deliveredItems);
    acc.kitchenItems = acc.kitchenItems.plus(row.kitchenItems);
    acc.productionValue = acc.productionValue.plus(row.productionValue);
    acc.billedValue = acc.billedValue.plus(row.billedValue);
    acc.tips = acc.tips.plus(row.tips);
    acc.expectedSettlement = acc.expectedSettlement.plus(row.expectedSettlement);
    acc.settledValue = acc.settledValue.plus(row.settledValue);
    return acc;
  }, makeAccumulator());
  const totals = finishAccumulator('TOTAL', totalsAcc);
  const production = Object.fromEntries(STATIONS.map((station) => {
    const row = productionAcc[station];
    return [station, { station, commands: row.commands, deliveredItems: qtyString(row.deliveredItems), value: moneyString(row.value), readyNotDelivered: row.readyNotDelivered }];
  }));
  const status = snapshots.some((row) => row.status === 'REVISAR') || exceptions.some((row) => row.severity === 'HIGH') || !cashDiff.eq(0) || !decimal(totals.difference).eq(0) ? 'REVISAR' : 'CUADRADO';

  return {
    marker: MARKER,
    version: VERSION,
    kind: 'DAY',
    businessDate: date,
    shiftCount: snapshots.length,
    status,
    channels,
    totals: { ...totals, accountsCharged: operations.filter((row) => row.state === 'COBRADA').length, kitchenDeliveredItems: production.COCINA.deliveredItems },
    production,
    payments: finishPayments(paymentAcc),
    cash: { openingBalance: moneyString(cashOpening), cashIncome: moneyString(cashIncome), voucherIncome: moneyString(voucherIncome), cashOut: moneyString(cashOut), expectedCash: moneyString(expectedCash), countedCash: moneyString(countedCash), difference: moneyString(cashDiff) },
    shifts: snapshots.map((row) => previewFromSnapshot(row)),
    operations,
    movements,
    exceptions
  };
}

async function getDay(tenantId, userId, date, options = {}, client = prisma) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(400, 'Fecha de cierre inválida', 'RESTAURANT_SHIFT_CLOSE_DATE_INVALID');
  const offset = normalizeOffset(options.tzOffsetMinutes);
  const auditRows = await client.auditoriaContable.findMany({
    where: { tenantId, entidad: AUDIT_ENTITY, accion: SNAPSHOT_ACTION },
    orderBy: { creadoEn: 'desc' },
    take: 1000
  });
  const byShift = new Map();
  for (const row of auditRows) {
    const snapshot = snapshotFromAudit(row);
    if (snapshot?.businessDate === day && !byShift.has(snapshot.shift.id)) byShift.set(snapshot.shift.id, snapshot);
  }
  const shifts = await client.aperturaCierreCaja.findMany({
    where: { tenantId, estado: 'CERRADA' },
    select: { id: true, userId: true, abiertoEn: true, cerradoEn: true },
    orderBy: { cerradoEn: 'desc' },
    take: 1000
  });
  for (const shift of shifts) {
    if (byShift.has(shift.id) || businessDate(shift.abiertoEn, offset) !== day) continue;
    const snapshot = await ensureSnapshot(tenantId, userId, shift.id, { tzOffsetMinutes: offset }, client);
    byShift.set(shift.id, snapshot);
  }
  return aggregateSnapshots([...byShift.values()], day);
}

async function queuePrint(tenantId, userId, shiftId, options = {}, client = prisma) {
  const snapshot = await ensureSnapshot(tenantId, userId, shiftId, options, client);
  const queued = await posReceiptPrint.queueShiftCloseSnapshotIntent(tenantId, shiftId, snapshot, client);
  if (!queued?.queued) throw new AppError(409, 'No fue posible preparar la impresión del cierre', 'RESTAURANT_SHIFT_CLOSE_PRINT_QUEUE_FAILED', { reason: queued?.reason || 'UNKNOWN' });
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: AUDIT_ENTITY,
      entidadId: shiftId,
      accion: PRINT_ACTION,
      metadata: {
        marker: MARKER,
        version: VERSION,
        label: options.origin === 'CLOSE_FLOW' ? 'Imprimir cierre al finalizar turno' : 'Reimprimir cierre histórico',
        businessDate: snapshot.businessDate,
        printRequestId: queued.printRequestId || null,
        origin: options.origin || 'HISTORY'
      }
    }
  });
  return { marker: MARKER, shiftId, businessDate: snapshot.businessDate, queued: true, printRequestId: queued.printRequestId || null };
}

function row(section, reference, concept, time, quantity, value) {
  return [section, reference || '', concept || '', time || '', quantity ?? '', value ?? ''];
}

function pdfSpec(tenant, report) {
  const titleDate = report.businessDate || report.shift?.businessDate || 'cierre';
  const rows = [];
  rows.push(row('RESUMEN', '', 'Estado', '', '', report.status));
  rows.push(row('RESUMEN', '', 'Turnos', '', report.shiftCount || 1, ''));
  rows.push(row('CONCILIACIÓN', '', 'Valor facturado', '', report.totals?.tickets || 0, number(report.totals?.billedValue)));
  rows.push(row('CONCILIACIÓN', '', 'Valor recaudado / liquidado', '', report.totals?.accountsCharged || 0, number(report.totals?.settledValue)));
  rows.push(row('CONCILIACIÓN', '', 'Diferencia operativa', '', '', number(report.totals?.difference)));
  rows.push(row('PRODUCCIÓN', 'COCINA', 'Platos entregados', '', report.production?.COCINA?.deliveredItems || 0, number(report.production?.COCINA?.value)));
  rows.push(row('PRODUCCIÓN', 'BARRA', 'Ítems entregados', '', report.production?.BARRA?.deliveredItems || 0, number(report.production?.BARRA?.value)));
  rows.push(row('PRODUCCIÓN', 'POSTRES', 'Ítems entregados', '', report.production?.POSTRES?.deliveredItems || 0, number(report.production?.POSTRES?.value)));
  for (const key of CHANNELS) {
    const channel = report.channels?.[key] || emptyChannel(key);
    rows.push(row('CANALES', key, `${channel.tickets} ticket(s)`, '', channel.deliveredItems, number(channel.settledValue)));
  }
  rows.push(row('PAGOS', 'EFECTIVO', 'Recaudo', '', '', number(report.payments?.cash)));
  rows.push(row('PAGOS', 'TRANSFERENCIA', 'Recaudo', '', '', number(report.payments?.transfer)));
  rows.push(row('PAGOS', 'TARJETA', 'Recaudo', '', '', number(report.payments?.card)));
  rows.push(row('PAGOS', 'CRÉDITO', 'Venta justificada a cartera', '', '', number(report.payments?.credit)));
  rows.push(row('CAJA', '', 'Efectivo esperado', '', '', number(report.cash?.expectedCash)));
  rows.push(row('CAJA', '', 'Efectivo contado', '', '', number(report.cash?.countedCash)));
  rows.push(row('CAJA', '', 'Descuadre', '', '', number(report.cash?.difference)));
  for (const item of report.exceptions || []) rows.push(row('EXCEPCIÓN', item.reference || '', item.type || 'Revisar', item.at || '', item.quantity || '', number(item.value || 0)));
  return {
    title: `Cierre operativo ${titleDate} - ${tenant.nombreEmpresa || tenant.subdomain}`,
    headers: ['Sección', 'Referencia', 'Concepto', 'Hora', 'Cantidad', 'Valor'],
    columns: [
      { label: 'Sección', width: 0.15, type: 'text', align: 'left' },
      { label: 'Referencia', width: 0.16, type: 'text', align: 'left' },
      { label: 'Concepto', width: 0.31, type: 'text', align: 'left' },
      { label: 'Hora', width: 0.16, type: 'text', align: 'left' },
      { label: 'Cantidad', width: 0.1, type: 'number', align: 'right' },
      { label: 'Valor', width: 0.12, type: 'number', align: 'right' }
    ],
    rows,
    rowStyles: rows.map((entry) => entry[0] === 'EXCEPCIÓN' ? 'section' : 'data')
  };
}

function excelSpec(tenant, report) {
  const rows = [];
  for (const operation of report.operations || []) {
    rows.push([
      operation.channel || '', operation.reference || '', operation.saleNumber || '', operation.openedAt || '', operation.orderAt || '', operation.accountAt || '', operation.collectedAt || '', operation.collectedBy || '', number(operation.billedValue), number(operation.collectedValue), operation.paymentMethod || '', operation.state || ''
    ]);
  }
  if (!rows.length) rows.push(['', '', '', '', '', '', '', '', 0, 0, '', 'Sin operaciones']);
  return {
    title: `Planilla cierre ${report.businessDate || ''} - ${tenant.nombreEmpresa || tenant.subdomain}`,
    headers: ['Canal', 'Mesa / Ticket', 'Venta', 'Apertura', 'Hora pedido', 'Hora cuenta', 'Hora cobro', 'Quién cobró', 'Valor facturado', 'Valor recaudado', 'Método', 'Estado'],
    columns: [
      { label: 'Canal', width: 0.08, type: 'text', align: 'left' },
      { label: 'Mesa / Ticket', width: 0.1, type: 'text', align: 'left' },
      { label: 'Venta', width: 0.08, type: 'text', align: 'left' },
      { label: 'Apertura', width: 0.09, type: 'text', align: 'left' },
      { label: 'Hora pedido', width: 0.09, type: 'text', align: 'left' },
      { label: 'Hora cuenta', width: 0.09, type: 'text', align: 'left' },
      { label: 'Hora cobro', width: 0.09, type: 'text', align: 'left' },
      { label: 'Quién cobró', width: 0.1, type: 'text', align: 'left' },
      { label: 'Valor facturado', width: 0.08, type: 'number', align: 'right' },
      { label: 'Valor recaudado', width: 0.08, type: 'number', align: 'right' },
      { label: 'Método', width: 0.06, type: 'text', align: 'left' },
      { label: 'Estado', width: 0.06, type: 'text', align: 'left' }
    ],
    rows,
    rowStyles: rows.map(() => 'data')
  };
}

async function tenantIdentity(tenantId, client = prisma) {
  const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { id: true, nit: true, nombreEmpresa: true, subdomain: true, moneda: true, pais: true } });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'TENANT_NOT_FOUND');
  return tenant;
}

async function exportReport(tenantId, report, format, client = prisma) {
  const tenant = await tenantIdentity(tenantId, client);
  const normalized = String(format || '').toLowerCase();
  if (['xls', 'excel'].includes(normalized)) {
    const spec = excelSpec(tenant, report);
    return { buffer: toExcelHtml(spec), mime: 'application/vnd.ms-excel', extension: 'xls', title: spec.title };
  }
  if (normalized === 'pdf') {
    const spec = pdfSpec(tenant, report);
    return { buffer: toSimplePdf(spec), mime: 'application/pdf', extension: 'pdf', title: spec.title };
  }
  throw new AppError(400, 'Formato de cierre no soportado', 'RESTAURANT_SHIFT_CLOSE_EXPORT_FORMAT_INVALID');
}

async function exportClosure(tenantId, userId, shiftId, format, options = {}, client = prisma) {
  return exportReport(tenantId, await getClosure(tenantId, userId, shiftId, options, client), format, client);
}

async function exportDay(tenantId, userId, date, format, options = {}, client = prisma) {
  return exportReport(tenantId, await getDay(tenantId, userId, date, options, client), format, client);
}

module.exports = {
  MARKER,
  VERSION,
  AUDIT_ENTITY,
  SNAPSHOT_ACTION,
  PRINT_ACTION,
  CHANNELS,
  STATIONS,
  DEFAULT_TZ_OFFSET_MINUTES,
  number,
  moneyString,
  normalizeOffset,
  businessDate,
  classifyTableChannel,
  emptyChannel,
  buildSnapshot,
  snapshotFromAudit,
  ensureSnapshot,
  listClosures,
  getClosure,
  aggregateSnapshots,
  getDay,
  queuePrint,
  pdfSpec,
  excelSpec,
  exportClosure,
  exportDay
};