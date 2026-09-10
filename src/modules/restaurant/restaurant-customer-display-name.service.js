'use strict';

const { prisma } = require('../../config/prisma');
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

module.exports = {
  ...displayName,
  stageCustomerNameForTable,
  restoreCustomerNameIfDraft
};
