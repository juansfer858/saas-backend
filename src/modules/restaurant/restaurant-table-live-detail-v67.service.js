'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const MARKER = 'VANTIX_RESTAURANT_TABLE_LIVE_DETAIL_V67';
const ACTIVE_STATES = ['ABIERTA', 'CUENTA_PEDIDA'];
const CONTROL_CENTER_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

function assertTableAccess(user, table) {
  if (user?.rol === 'MESERO' && table?.assignedWaiterId && table.assignedWaiterId !== user.id) {
    throw new AppError(403, 'La mesa está asignada a otro mesero', 'RESTAURANT_WAITER_TABLE_FORBIDDEN');
  }
}

function canCancelForUser(user, session) {
  if (user?.rol === 'MESERO') return Boolean(session?.openedByUserId && session.openedByUserId === user.id);
  return true;
}

function canManageDraftFromControlCenter(user) {
  return CONTROL_CENTER_ROLES.has(String(user?.rol || '').trim().toUpperCase());
}

function assertControlCenterDraftManager(user) {
  if (!canManageDraftFromControlCenter(user)) {
    throw new AppError(403, 'Solo Administración puede retirar desde Centro de control un producto que otro operador dejó por enviar.', 'RESTAURANT_CONTROL_CENTER_DRAFT_FORBIDDEN');
  }
}

function itemState(order, item) {
  const orderState = String(order?.state || '').toUpperCase();
  if (orderState === 'BORRADOR') return 'POR_ENVIAR';
  if (orderState === 'CANCELADO') return 'CANCELADO';
  const command = (order?.commands || []).find((row) => String(row.station || '').toUpperCase() === String(item?.station || '').toUpperCase());
  const commandState = String(command?.state || '').toUpperCase();
  if (commandState === 'EN_PREPARACION') return 'EN_PREPARACION';
  if (commandState === 'LISTA') return 'LISTO';
  if (commandState === 'ENTREGADA') return 'ENTREGADO';
  if (commandState === 'CANCELADA') return 'CANCELADO';
  return 'PENDIENTE';
}

function numeric(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

async function loadTableAndSession(tenantId, user, tableId, client = prisma) {
  const table = await client.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
  if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
  assertTableAccess(user, table);
  const session = await client.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ACTIVE_STATES } },
    orderBy: { openedAt: 'desc' }
  });
  return { table, session };
}

async function liveDetail(tenantId, user, tableId) {
  const { table, session } = await loadTableAndSession(tenantId, user, tableId);
  if (!session) {
    return {
      marker: MARKER,
      table,
      open: false,
      session: null,
      sale: null,
      items: [],
      summary: { orderedQuantity: 0, deliveredQuantity: 0, remainingQuantity: 0, readyQuantity: 0, draftQuantity: 0, total: '0' },
      canCancelOpening: false,
      canManageDraftFromControlCenter: canManageDraftFromControlCenter(user)
    };
  }

  const [sale, orders, payments, fiscalDocuments, activeQrDevices] = await Promise.all([
    prisma.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId },
      select: { id: true, numero: true, estado: true, subtotal: true, ivaTotal: true, impoconsumoTotal: true, total: true, saldo: true, formaPago: true }
    }),
    prisma.restaurantOrder.findMany({
      where: { tenantId, sessionId: session.id },
      include: { items: { orderBy: { creadoEn: 'asc' } }, commands: true },
      orderBy: { creadoEn: 'asc' }
    }),
    prisma.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } }),
    prisma.restaurantFiscalDocument.count({ where: { tenantId, sessionId: session.id } }),
    prisma.restaurantQrVisitDevice.count({ where: { tenantId, sessionId: session.id, revokedAt: null } })
  ]);

  const controlCenterDraftManager = canManageDraftFromControlCenter(user);
  const items = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const state = itemState(order, item);
      items.push({
        id: item.id,
        orderId: order.id,
        orderState: order.state,
        source: order.source,
        createdAt: order.creadoEn,
        menuItemId: item.menuItemId,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        lineTotal: String(item.lineTotal),
        station: item.station,
        seatNumber: item.seatNumber,
        notes: item.notes,
        state,
        canRemoveFromControlCenter: controlCenterDraftManager && state === 'POR_ENVIAR'
      });
    }
  }

  const activeItems = items.filter((row) => !['POR_ENVIAR', 'CANCELADO'].includes(row.state));
  const orderedQuantity = activeItems.reduce((sum, row) => sum + numeric(row.quantity), 0);
  const deliveredQuantity = activeItems.filter((row) => row.state === 'ENTREGADO').reduce((sum, row) => sum + numeric(row.quantity), 0);
  const readyQuantity = activeItems.filter((row) => row.state === 'LISTO').reduce((sum, row) => sum + numeric(row.quantity), 0);
  const remainingQuantity = activeItems.filter((row) => row.state !== 'ENTREGADO').reduce((sum, row) => sum + numeric(row.quantity), 0);
  const draftQuantity = items.filter((row) => row.state === 'POR_ENVIAR').reduce((sum, row) => sum + numeric(row.quantity), 0);
  const hasRealOrder = orders.some((order) => order.state !== 'BORRADOR') || items.length > 0;
  const canCancelOpening = Boolean(
    canCancelForUser(user, session)
    && sale?.estado === 'BORRADOR'
    && numeric(sale?.total) === 0
    && !hasRealOrder
    && payments === 0
    && fiscalDocuments === 0
    && activeQrDevices === 0
    && !session.accountRequestedAt
    && !session.accountPreparedAt
    && !session.cashierRequestedAt
  );

  return {
    marker: MARKER,
    table,
    open: true,
    session,
    sale,
    items,
    summary: {
      orderedQuantity,
      deliveredQuantity,
      remainingQuantity,
      readyQuantity,
      draftQuantity,
      total: String(sale?.total || 0)
    },
    canCancelOpening,
    canManageDraftFromControlCenter: controlCenterDraftManager
  };
}

async function removeDraftItemFromControlCenter(tenantId, user, tableId, itemId) {
  assertControlCenterDraftManager(user);
  return prisma.$transaction(async (tx) => {
    const { table, session } = await loadTableAndSession(tenantId, user, tableId, tx);
    if (!session) throw new AppError(404, 'La mesa ya no tiene una cuenta abierta.', 'RESTAURANT_CONTROL_CENTER_SESSION_NOT_FOUND');

    const item = await tx.restaurantOrderItem.findFirst({
      where: { id: itemId, tenantId },
      select: {
        id: true,
        orderId: true,
        saleDetailId: true,
        description: true,
        quantity: true,
        lineTotal: true,
        seatNumber: true,
        station: true
      }
    });
    if (!item) throw new AppError(404, 'El producto por retirar ya no existe.', 'RESTAURANT_CONTROL_CENTER_DRAFT_ITEM_NOT_FOUND');

    const order = await tx.restaurantOrder.findFirst({
      where: { id: item.orderId, tenantId, sessionId: session.id },
      select: { id: true, state: true, source: true, createdByUserId: true }
    });
    if (!order) throw new AppError(409, 'El producto no pertenece a la visita activa de esta mesa.', 'RESTAURANT_CONTROL_CENTER_DRAFT_ITEM_WRONG_SESSION');
    if (String(order.state || '').toUpperCase() !== 'BORRADOR') {
      throw new AppError(409, 'Este producto ya fue enviado. No puede retirarse silenciosamente; debe usar el flujo de cancelación de producto enviado.', 'RESTAURANT_CONTROL_CENTER_ITEM_ALREADY_SENT');
    }

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' },
      select: { id: true, subtotal: true, ivaTotal: true, impoconsumoTotal: true, total: true }
    });
    if (!sale) throw new AppError(409, 'La venta de la mesa ya no admite cambios de borrador.', 'RESTAURANT_CONTROL_CENTER_SALE_NOT_DRAFT');
    if (!item.saleDetailId) throw new AppError(409, 'La línea no tiene detalle comercial asociado.', 'RESTAURANT_CONTROL_CENTER_DRAFT_DETAIL_MISSING');

    const detail = await tx.detalleComprobante.findFirst({
      where: { id: item.saleDetailId, tenantId, comprobanteId: sale.id },
      select: { id: true, subtotalLinea: true, ivaValor: true, impoconsumoValor: true, totalLinea: true }
    });
    if (!detail) throw new AppError(409, 'No se encontró el detalle comercial de la línea por retirar.', 'RESTAURANT_CONTROL_CENTER_DRAFT_DETAIL_NOT_FOUND');

    await tx.restaurantOrderItem.delete({ where: { id: item.id } });
    await tx.detalleComprobante.delete({ where: { id: detail.id } });
    await tx.restaurantOrder.update({ where: { id: order.id }, data: { total: { decrement: detail.totalLinea } } });
    const updatedSale = await tx.comprobanteComercial.update({
      where: { id: sale.id },
      data: {
        subtotal: { decrement: detail.subtotalLinea },
        ivaTotal: { decrement: detail.ivaValor },
        impoconsumoTotal: { decrement: detail.impoconsumoValor },
        total: { decrement: detail.totalLinea }
      },
      select: { id: true, numero: true, total: true }
    });

    return {
      marker: MARKER,
      removed: true,
      table: { id: table.id, name: table.name, code: table.code },
      sessionId: session.id,
      orderId: order.id,
      item: {
        id: item.id,
        description: item.description,
        quantity: String(item.quantity),
        lineTotal: String(item.lineTotal),
        station: item.station,
        seatNumber: item.seatNumber
      },
      sale: { id: updatedSale.id, numero: updatedSale.numero, total: String(updatedSale.total) }
    };
  });
}

async function cancelEmptyOpening(tenantId, user, tableId) {
  return prisma.$transaction(async (tx) => {
    const { table, session } = await loadTableAndSession(tenantId, user, tableId, tx);
    if (!session) return { cancelled: false, alreadyFree: true, table };

    if (!canCancelForUser(user, session)) {
      throw new AppError(403, 'Solo el mesero que abrió la mesa puede cerrarla como apertura por error.', 'RESTAURANT_TABLE_OPENING_NOT_OWNER');
    }

    const [sale, orders, payments, fiscalDocuments, activeQrDevices] = await Promise.all([
      tx.comprobanteComercial.findFirst({
        where: { id: session.saleId, tenantId },
        include: { detalles: true }
      }),
      tx.restaurantOrder.findMany({
        where: { tenantId, sessionId: session.id },
        include: { items: true, commands: true }
      }),
      tx.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } }),
      tx.restaurantFiscalDocument.count({ where: { tenantId, sessionId: session.id } }),
      tx.restaurantQrVisitDevice.count({ where: { tenantId, sessionId: session.id, revokedAt: null } })
    ]);

    const hasItems = orders.some((order) => (order.items || []).length > 0);
    const hasSentOrder = orders.some((order) => order.state !== 'BORRADOR');
    const hasCommands = orders.some((order) => (order.commands || []).length > 0);
    const protectedActivity = hasItems || hasSentOrder || hasCommands || payments > 0 || fiscalDocuments > 0 || activeQrDevices > 0
      || Boolean(session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt);

    if (protectedActivity) {
      throw new AppError(409, 'La mesa ya tiene actividad real. No puede cerrarse como apertura por error.', 'RESTAURANT_TABLE_OPENING_HAS_ACTIVITY');
    }
    if (!sale || sale.estado !== 'BORRADOR' || numeric(sale.total) !== 0 || (sale.detalles || []).length > 0) {
      throw new AppError(409, 'La venta de la mesa ya tiene información comercial y no puede descartarse como apertura vacía.', 'RESTAURANT_TABLE_OPENING_SALE_NOT_EMPTY');
    }

    const draftIds = orders.filter((order) => order.state === 'BORRADOR').map((order) => order.id);
    if (draftIds.length) await tx.restaurantOrder.deleteMany({ where: { tenantId, id: { in: draftIds } } });
    await tx.restaurantTableSession.delete({ where: { id: session.id } });
    await tx.comprobanteComercial.delete({ where: { id: sale.id } });
    const freed = await tx.restaurantTable.update({ where: { id: table.id }, data: { state: 'LIBRE' } });
    return { cancelled: true, alreadyFree: false, table: freed, sessionId: session.id, discardedSaleId: sale.id };
  });
}

module.exports = {
  MARKER,
  liveDetail,
  cancelEmptyOpening,
  removeDraftItemFromControlCenter,
  itemState,
  canCancelForUser,
  canManageDraftFromControlCenter
};
