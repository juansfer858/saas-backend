'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

async function removeUnsentWaiterDraftItem(tenantId, sessionId, itemId) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      select: { id: true, saleId: true, tableId: true }
    });
    if (!session) {
      throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');
    }

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' },
      select: { id: true }
    });
    if (!sale) {
      throw new AppError(409, 'La venta de la mesa ya no está en borrador', 'RESTAURANT_SALE_NOT_DRAFT');
    }

    const item = await tx.restaurantOrderItem.findFirst({
      where: { id: itemId, tenantId },
      select: {
        id: true,
        orderId: true,
        saleDetailId: true,
        description: true,
        quantity: true,
        lineTotal: true
      }
    });
    if (!item) {
      throw new AppError(404, 'Producto pendiente no encontrado', 'RESTAURANT_DRAFT_ITEM_NOT_FOUND');
    }

    const order = await tx.restaurantOrder.findFirst({
      where: {
        id: item.orderId,
        tenantId,
        sessionId: session.id,
        source: 'MESERO',
        state: 'BORRADOR'
      },
      select: { id: true }
    });
    if (!order) {
      throw new AppError(
        409,
        'Este producto ya fue enviado o no pertenece al borrador de esta mesa. No se puede retirar desde Pedidos.',
        'RESTAURANT_DRAFT_ITEM_ALREADY_SENT'
      );
    }

    const detail = await tx.detalleComprobante.findFirst({
      where: {
        id: item.saleDetailId,
        tenantId,
        comprobanteId: sale.id
      },
      select: {
        id: true,
        subtotalLinea: true,
        ivaValor: true,
        impoconsumoValor: true,
        totalLinea: true
      }
    });
    if (!detail) {
      throw new AppError(
        409,
        'La línea pendiente no coincide con la cuenta de la mesa',
        'RESTAURANT_DRAFT_ITEM_SALE_DETAIL_INVALID'
      );
    }

    await tx.restaurantOrderItem.delete({ where: { id: item.id } });
    await tx.detalleComprobante.delete({ where: { id: detail.id } });
    await tx.restaurantOrder.update({
      where: { id: order.id },
      data: { total: { decrement: detail.totalLinea } }
    });
    await tx.comprobanteComercial.update({
      where: { id: sale.id },
      data: {
        subtotal: { decrement: detail.subtotalLinea },
        ivaTotal: { decrement: detail.ivaValor },
        impoconsumoTotal: { decrement: detail.impoconsumoValor },
        total: { decrement: detail.totalLinea }
      }
    });

    return {
      removed: true,
      sessionId: session.id,
      tableId: session.tableId,
      orderId: order.id,
      itemId: item.id,
      description: item.description,
      quantity: item.quantity,
      amountRemoved: detail.totalLinea
    };
  });
}

module.exports = { removeUnsentWaiterDraftItem };
