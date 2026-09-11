'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const CUSTOMER_TYPES = Object.freeze(['CLIENTE', 'CLIENTE_PROVEEDOR']);
const GENERIC_CUSTOMER_IDENTIFICATION = '222222222222';

function publicCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    tipo: customer.tipo,
    tipoDocumento: customer.tipoDocumento,
    identificacion: customer.identificacion,
    nombre: customer.nombre,
    razonSocial: customer.razonSocial || null,
    direccion: customer.direccion || null,
    telefono: customer.telefono || null,
    email: customer.email || null
  };
}

async function stageIdentifiedCustomerForTable(tenantId, tableId, terceroId) {
  const customerId = String(terceroId || '').trim();
  if (!customerId) return null;

  return prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      orderBy: { openedAt: 'desc' },
      select: { id: true, saleId: true }
    });
    if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: 'BORRADOR' },
      select: { id: true, terceroId: true }
    });
    if (!sale) throw new AppError(409, 'La venta de la mesa ya no está disponible para identificar cliente', 'RESTAURANT_SALE_NOT_DRAFT');

    const customer = await tx.tercero.findFirst({
      where: {
        id: customerId,
        tenantId,
        activo: true,
        tipo: { in: CUSTOMER_TYPES }
      }
    });
    if (!customer || String(customer.identificacion || '').trim() === GENERIC_CUSTOMER_IDENTIFICATION) {
      throw new AppError(400, 'Selecciona un cliente identificado y activo', 'RESTAURANT_CUSTOMER_INVALID');
    }

    const previousTerceroId = sale.terceroId || null;
    if (previousTerceroId !== customer.id) {
      await tx.comprobanteComercial.update({
        where: { id: sale.id },
        data: { terceroId: customer.id }
      });
    }

    return {
      sessionId: session.id,
      saleId: sale.id,
      previousTerceroId,
      stagedTerceroId: customer.id,
      customer: publicCustomer(customer)
    };
  });
}

async function restoreIdentifiedCustomerIfDraft(stage) {
  if (!stage?.saleId) return false;
  const result = await prisma.comprobanteComercial.updateMany({
    where: {
      id: stage.saleId,
      estado: 'BORRADOR',
      terceroId: stage.stagedTerceroId
    },
    data: { terceroId: stage.previousTerceroId || null }
  });
  return result.count > 0;
}

module.exports = {
  CUSTOMER_TYPES,
  GENERIC_CUSTOMER_IDENTIFICATION,
  publicCustomer,
  stageIdentifiedCustomerForTable,
  restoreIdentifiedCustomerIfDraft
};
