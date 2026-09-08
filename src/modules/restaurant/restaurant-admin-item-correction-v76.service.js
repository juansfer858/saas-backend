'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');
const { auditInTx } = require('../accounting/accounting-audit.service');

const MARKER = 'VANTIX_RESTAURANT_ADMIN_ITEM_CORRECTION_V76';
const AUDIT_ENTITY = 'COMPROBANTE_COMERCIAL';
const AUDIT_ACTION = 'RESTAURANT_ADMIN_REMOVE_ITEM_V76';

function cleanReason(value) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  if (reason.length < 5) throw new AppError(400, 'Escribe un motivo de al menos 5 caracteres.', 'RESTAURANT_ADMIN_CORRECTION_REASON_REQUIRED');
  if (reason.length > 300) throw new AppError(400, 'El motivo no puede superar 300 caracteres.', 'RESTAURANT_ADMIN_CORRECTION_REASON_TOO_LONG');
  return reason;
}

function recalculateOrderState(commands, fallback = 'ENVIADO') {
  const active = (commands || []).filter((command) => command.state !== 'CANCELADA');
  if (!active.length) return 'CANCELADO';
  if (active.every((command) => command.state === 'ENTREGADA')) return 'ENTREGADO';
  if (active.every((command) => ['LISTA', 'ENTREGADA'].includes(command.state))) return 'LISTO';
  if (active.some((command) => command.state === 'EN_PREPARACION')) return 'EN_PREPARACION';
  return fallback === 'BORRADOR' ? 'BORRADOR' : 'ENVIADO';
}

function snapshotItem(item, detail) {
  return {
    id: item.id,
    orderId: item.orderId,
    menuItemId: item.menuItemId,
    productId: item.productId,
    saleDetailId: item.saleDetailId,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    lineTotal: String(item.lineTotal),
    station: item.station,
    seatNumber: item.seatNumber,
    notes: item.notes || null,
    orderState: item.order?.state || null,
    source: item.order?.source || null,
    saleDetail: detail ? {
      id: detail.id,
      descripcion: detail.descripcion,
      cantidad: String(detail.cantidad),
      precioUnitario: String(detail.precioUnitario),
      subtotalLinea: String(detail.subtotalLinea),
      ivaValor: String(detail.ivaValor),
      impoconsumoValor: String(detail.impoconsumoValor),
      totalLinea: String(detail.totalLinea)
    } : null
  };
}

async function removeItem(tenantId, user, itemId, input = {}) {
  const reason = cleanReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const item = await tx.restaurantOrderItem.findFirst({
      where: { id: itemId, tenantId },
      include: { order: { include: { session: { include: { table: true } }, commands: true } } }
    });
    if (!item) throw new AppError(404, 'Producto de la cuenta no encontrado.', 'RESTAURANT_ADMIN_CORRECTION_ITEM_NOT_FOUND');

    const session = item.order?.session;
    if (!session || !['ABIERTA', 'CUENTA_PEDIDA'].includes(session.state)) {
      throw new AppError(409, 'La mesa ya no tiene una cuenta activa que pueda corregirse.', 'RESTAURANT_ADMIN_CORRECTION_SESSION_CLOSED');
    }

    const [sale, detail, paymentCount, fiscalCount] = await Promise.all([
      tx.comprobanteComercial.findFirst({
        where: { id: session.saleId, tenantId },
        select: {
          id: true, numero: true, estado: true, subtotal: true, ivaTotal: true,
          impoconsumoTotal: true, total: true, saldo: true, emitidoEn: true, anuladoEn: true
        }
      }),
      tx.detalleComprobante.findFirst({ where: { id: item.saleDetailId, tenantId, comprobanteId: session.saleId } }),
      tx.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } }),
      tx.restaurantFiscalDocument.count({ where: { tenantId, sessionId: session.id } })
    ]);

    if (!sale || sale.estado !== 'BORRADOR' || sale.emitidoEn || sale.anuladoEn || paymentCount > 0 || fiscalCount > 0) {
      throw new AppError(
        409,
        'La cuenta ya fue pagada, emitida o fiscalizada. No se puede reescribir; debe usarse un documento de corrección.',
        'RESTAURANT_ADMIN_CORRECTION_FISCAL_LOCK'
      );
    }
    if (!detail) {
      throw new AppError(409, 'El producto no tiene un detalle comercial íntegro para corregir.', 'RESTAURANT_ADMIN_CORRECTION_DETAIL_MISSING');
    }

    const before = {
      sale: {
        id: sale.id,
        numero: sale.numero,
        estado: sale.estado,
        subtotal: String(sale.subtotal),
        ivaTotal: String(sale.ivaTotal),
        impoconsumoTotal: String(sale.impoconsumoTotal),
        total: String(sale.total),
        saldo: String(sale.saldo)
      },
      session: {
        id: session.id,
        tableId: session.tableId,
        tableName: session.table?.name || null,
        state: session.state,
        accountRequestedAt: session.accountRequestedAt,
        accountPreparedAt: session.accountPreparedAt,
        cashierRequestedAt: session.cashierRequestedAt
      },
      item: snapshotItem(item, detail),
      commands: (item.order?.commands || []).map((command) => ({ id: command.id, station: command.station, state: command.state }))
    };

    await tx.restaurantOrderItem.delete({ where: { id: item.id } });
    await tx.detalleComprobante.delete({ where: { id: detail.id } });

    const remainingItems = await tx.restaurantOrderItem.findMany({ where: { tenantId, orderId: item.orderId } });
    let orderState = item.order.state;
    if (!remainingItems.length) {
      await tx.restaurantCommand.updateMany({
        where: { tenantId, orderId: item.orderId, state: { not: 'CANCELADA' } },
        data: { state: 'CANCELADA' }
      });
      orderState = 'CANCELADO';
      await tx.restaurantOrder.update({ where: { id: item.orderId }, data: { total: 0, state: orderState } });
    } else {
      await tx.restaurantOrder.update({
        where: { id: item.orderId },
        data: { total: { decrement: detail.totalLinea } }
      });
      const sameStationRemaining = remainingItems.some((row) => row.station === item.station);
      if (item.order.state !== 'BORRADOR' && !sameStationRemaining) {
        await tx.restaurantCommand.updateMany({
          where: { tenantId, orderId: item.orderId, station: item.station, state: { not: 'CANCELADA' } },
          data: { state: 'CANCELADA' }
        });
      }
      if (item.order.state !== 'BORRADOR') {
        const commands = await tx.restaurantCommand.findMany({ where: { tenantId, orderId: item.orderId } });
        orderState = recalculateOrderState(commands, item.order.state);
        await tx.restaurantOrder.update({ where: { id: item.orderId }, data: { state: orderState } });
      }
    }

    const newSubtotal = money(sale.subtotal).minus(money(detail.subtotalLinea));
    const newIva = money(sale.ivaTotal).minus(money(detail.ivaValor));
    const newImpoconsumo = money(sale.impoconsumoTotal).minus(money(detail.impoconsumoValor));
    const newTotal = money(sale.total).minus(money(detail.totalLinea));
    if (newSubtotal.lt(0) || newIva.lt(0) || newImpoconsumo.lt(0) || newTotal.lt(0)) {
      throw new AppError(409, 'Los totales de la cuenta no son consistentes para esta corrección.', 'RESTAURANT_ADMIN_CORRECTION_TOTAL_MISMATCH');
    }

    const updatedSale = await tx.comprobanteComercial.update({
      where: { id: sale.id },
      data: {
        subtotal: newSubtotal,
        ivaTotal: newIva,
        impoconsumoTotal: newImpoconsumo,
        total: newTotal
      },
      select: { id: true, numero: true, estado: true, subtotal: true, ivaTotal: true, impoconsumoTotal: true, total: true, saldo: true }
    });

    // Una corrección invalida cualquier cuenta preparada/enviada previamente a Caja.
    // La mesa vuelve a ABIERTA para obligar a preparar/enviar de nuevo con el total correcto.
    if (session.state === 'CUENTA_PEDIDA' || session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt) {
      await tx.restaurantTableSession.update({
        where: { id: session.id },
        data: {
          state: 'ABIERTA',
          accountRequestedAt: null,
          accountPreparedAt: null,
          cashierRequestedAt: null
        }
      });
      await tx.restaurantTable.update({ where: { id: session.tableId }, data: { state: 'OCUPADA' } });
    }

    const afterCommands = await tx.restaurantCommand.findMany({
      where: { tenantId, orderId: item.orderId },
      select: { id: true, station: true, state: true }
    });

    await auditInTx(tx, {
      tenantId,
      userId: user.id,
      entidad: AUDIT_ENTITY,
      entidadId: sale.id,
      accion: AUDIT_ACTION,
      metadata: {
        marker: MARKER,
        reason,
        before,
        after: {
          sale: {
            id: updatedSale.id,
            numero: updatedSale.numero,
            estado: updatedSale.estado,
            subtotal: String(updatedSale.subtotal),
            ivaTotal: String(updatedSale.ivaTotal),
            impoconsumoTotal: String(updatedSale.impoconsumoTotal),
            total: String(updatedSale.total),
            saldo: String(updatedSale.saldo)
          },
          order: { id: item.orderId, state: orderState, remainingItems: remainingItems.length },
          commands: afterCommands,
          accountWorkflowReset: Boolean(session.state === 'CUENTA_PEDIDA' || session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt)
        }
      }
    });

    return {
      marker: MARKER,
      removed: true,
      reason,
      removedItem: snapshotItem(item, detail),
      sessionId: session.id,
      tableId: session.tableId,
      sale: updatedSale,
      order: { id: item.orderId, state: orderState, remainingItems: remainingItems.length },
      accountWorkflowReset: Boolean(session.state === 'CUENTA_PEDIDA' || session.accountRequestedAt || session.accountPreparedAt || session.cashierRequestedAt)
    };
  });
}

async function listCorrections(tenantId, saleId, limit = 100) {
  const sale = await prisma.comprobanteComercial.findFirst({
    where: { id: saleId, tenantId },
    select: { id: true, numero: true, estado: true }
  });
  if (!sale) throw new AppError(404, 'Venta no encontrada.', 'RESTAURANT_ADMIN_CORRECTION_SALE_NOT_FOUND');
  const rows = await prisma.auditoriaContable.findMany({
    where: { tenantId, entidad: AUDIT_ENTITY, entidadId: saleId, accion: AUDIT_ACTION },
    include: { user: { select: { id: true, nombre: true, email: true, rol: true } } },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(Math.max(Number(limit) || 100, 1), 200)
  });
  return { marker: MARKER, sale, rows };
}

module.exports = {
  MARKER,
  AUDIT_ENTITY,
  AUDIT_ACTION,
  cleanReason,
  recalculateOrderState,
  removeItem,
  listCorrections
};
