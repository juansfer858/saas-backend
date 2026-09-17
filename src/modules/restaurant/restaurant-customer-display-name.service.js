'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const displayName = require('./restaurant-customer-display-name');

async function stageCustomerNameForTable(tenantId, tableId, customerName) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    select: { id: true, saleId: true },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) return null;

  const sale = await prisma.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA' },
    select: { id: true, estado: true, observaciones: true }
  });
  if (!sale || sale.estado !== 'BORRADOR') return null;

  const nextObservations = displayName.mergeCustomerNameObservation(sale.observaciones, customerName);
  if (nextObservations !== sale.observaciones) {
    await prisma.comprobanteComercial.update({
      where: { id: sale.id },
      data: { observaciones: nextObservations }
    });
  }

  return {
    saleId: sale.id,
    previousObservations: sale.observaciones,
    stagedObservations: nextObservations,
    customerName: displayName.normalizeCustomerName(customerName)
  };
}

async function restoreCustomerNameIfDraft(stage) {
  if (!stage?.saleId) return false;
  const current = await prisma.comprobanteComercial.findUnique({
    where: { id: stage.saleId },
    select: { estado: true, observaciones: true }
  });
  if (!current || current.estado !== 'BORRADOR' || current.observaciones !== stage.stagedObservations) return false;
  await prisma.comprobanteComercial.update({
    where: { id: stage.saleId },
    data: { observaciones: stage.previousObservations }
  });
  return true;
}

async function customerNameContextForSale(tenantId, saleId, client = prisma) {
  const session = await client.restaurantTableSession.findFirst({
    where: { tenantId, saleId },
    select: { id: true, tableId: true, state: true, closedAt: true },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) return null;

  const sale = await client.comprobanteComercial.findFirst({
    where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA' },
    select: { id: true, numero: true, estado: true, observaciones: true, terceroId: true }
  });
  if (!sale) return null;

  const editable = sale.estado === 'BORRADOR';
  const blockedReason = sale.estado === 'ANULADO'
    ? 'SALE_CANCELLED'
    : editable ? null : 'SALE_SETTLED_REQUIRES_REISSUE';
  return {
    saleId: sale.id,
    saleNumber: sale.numero || null,
    saleState: sale.estado,
    sessionId: session.id,
    tableId: session.tableId,
    sessionState: session.state,
    customerName: displayName.customerNameFromObservations(sale.observaciones),
    terceroId: sale.terceroId || null,
    editable,
    blockedReason
  };
}

async function updateCustomerNameForSale(tenantId, userId, saleId, customerName) {
  return prisma.$transaction(async (tx) => {
    const context = await customerNameContextForSale(tenantId, saleId, tx);
    if (!context) {
      throw new AppError(404, 'La venta del restaurante no está disponible', 'RESTAURANT_RECEIPT_SALE_NOT_FOUND');
    }
    if (context.blockedReason === 'SALE_CANCELLED') {
      throw new AppError(409, 'Una venta anulada no admite cambios de nombre', 'RESTAURANT_RECEIPT_CUSTOMER_NAME_CANCELLED');
    }
    if (!context.editable) {
      throw new AppError(
        409,
        'Una venta liquidada no se edita. Para identificar el cliente debe anularse y recrearse de forma controlada.',
        'RESTAURANT_RECEIPT_CUSTOMER_NAME_REQUIRES_REISSUE'
      );
    }

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' },
      select: { id: true, observaciones: true }
    });
    if (!sale) {
      throw new AppError(409, 'La venta dejó de estar en borrador', 'RESTAURANT_RECEIPT_CUSTOMER_NAME_REQUIRES_REISSUE');
    }

    const previousCustomerName = displayName.customerNameFromObservations(sale.observaciones);
    const normalizedCustomerName = displayName.normalizeCustomerName(customerName);
    const nextObservations = displayName.mergeCustomerNameObservation(sale.observaciones, normalizedCustomerName);
    const changed = nextObservations !== sale.observaciones;

    if (changed) {
      await tx.comprobanteComercial.update({
        where: { id: sale.id },
        data: { observaciones: nextObservations }
      });
      await tx.auditoriaContable.create({
        data: {
          tenantId,
          userId,
          entidad: 'COMPROBANTE_COMERCIAL',
          entidadId: sale.id,
          accion: 'RESTAURANT_RECEIPT_CUSTOMER_NAME_UPDATED',
          metadata: {
            marker: 'VANTIX_RESTAURANT_RECEIPT_CUSTOMER_NAME_V127',
            scope: 'DRAFT_ONLY',
            sessionId: context.sessionId,
            tableId: context.tableId,
            saleNumber: context.saleNumber,
            terceroId: context.terceroId,
            before: previousCustomerName,
            after: normalizedCustomerName
          }
        }
      });
    }

    return {
      ...context,
      customerName: normalizedCustomerName,
      changed,
      marker: 'VANTIX_RESTAURANT_RECEIPT_CUSTOMER_NAME_V127'
    };
  });
}

module.exports = {
  ...displayName,
  stageCustomerNameForTable,
  restoreCustomerNameIfDraft,
  customerNameContextForSale,
  updateCustomerNameForSale
};
