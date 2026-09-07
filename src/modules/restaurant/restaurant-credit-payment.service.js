'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money } = require('../../utils/decimal');

const CUSTOMER_TYPES = Object.freeze(['CLIENTE', 'CLIENTE_PROVEEDOR']);
const GENERIC_CUSTOMER_IDENTIFICATION = '222222222222';

function dueDateFrom(saleDate, days) {
  const due = new Date(saleDate || Date.now());
  due.setHours(23, 59, 59, 999);
  due.setDate(due.getDate() + Math.max(0, Math.min(Number(days || 0), 3650)));
  return due;
}

async function prepareCreditClose(tenantId, tableId, terceroId) {
  const customerId = String(terceroId || '').trim();
  if (!customerId) {
    throw new AppError(400, 'Selecciona el cliente que recibirá el crédito', 'RESTAURANT_CREDIT_CUSTOMER_REQUIRED');
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      orderBy: { openedAt: 'desc' }
    });
    if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId, estado: 'BORRADOR', tipo: 'FACTURA_VENTA' }
    });
    if (!sale) throw new AppError(409, 'La venta de la mesa ya no está disponible para crédito', 'RESTAURANT_SALE_NOT_DRAFT');

    const customer = await tx.tercero.findFirst({
      where: {
        id: customerId,
        tenantId,
        activo: true,
        tipo: { in: CUSTOMER_TYPES }
      }
    });
    if (!customer || String(customer.identificacion || '').trim() === GENERIC_CUSTOMER_IDENTIFICATION) {
      throw new AppError(400, 'El crédito requiere un cliente identificado y activo', 'RESTAURANT_CREDIT_CUSTOMER_INVALID');
    }

    const receivables = await tx.cartera.aggregate({
      where: {
        tenantId,
        terceroId: customer.id,
        tipo: 'CXC',
        estado: { in: ['PENDIENTE', 'PARCIAL'] }
      },
      _sum: { saldo: true }
    });

    const outstanding = money(receivables._sum.saldo || 0);
    const saleTotal = money(sale.total || 0);
    const creditLimit = money(customer.cupoCredito || 0);
    const projected = money(outstanding.plus(saleTotal));

    // cupoCredito = 0 conserva compatibilidad con clientes históricos sin límite configurado.
    // Cuando existe un cupo positivo, sí se respeta como límite operativo real.
    if (creditLimit.gt(0) && projected.gt(creditLimit)) {
      throw new AppError(409, 'El crédito supera el cupo disponible del cliente', 'RESTAURANT_CREDIT_LIMIT_EXCEEDED', {
        customerId: customer.id,
        cupoCredito: creditLimit.toString(),
        saldoCarteraActual: outstanding.toString(),
        nuevaVenta: saleTotal.toString(),
        saldoProyectado: projected.toString(),
        cupoDisponible: money(creditLimit.minus(outstanding)).toString()
      });
    }

    const dueDate = dueDateFrom(sale.fecha, customer.diasPlazo || 0);
    await tx.comprobanteComercial.update({
      where: { id: sale.id },
      data: {
        terceroId: customer.id,
        formaPago: 'CREDITO',
        cajaBancoId: null,
        fechaVencimiento: dueDate
      }
    });

    return {
      sessionId: session.id,
      saleId: sale.id,
      customer: {
        id: customer.id,
        nombre: customer.nombre,
        identificacion: customer.identificacion,
        cupoCredito: String(customer.cupoCredito || 0),
        diasPlazo: Number(customer.diasPlazo || 0)
      },
      credit: {
        outstanding: outstanding.toString(),
        saleTotal: saleTotal.toString(),
        projected: projected.toString(),
        limit: creditLimit.toString(),
        dueDate: dueDate.toISOString()
      }
    };
  });
}

module.exports = {
  CUSTOMER_TYPES,
  GENERIC_CUSTOMER_IDENTIFICATION,
  dueDateFrom,
  prepareCreditClose
};
