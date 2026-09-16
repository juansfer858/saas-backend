const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const reservations = require('../inventory/inventory-reservation.service');

async function cancelWorkOrderSafe(tenantId, workOrderId, reason) {
  return prisma.$transaction(async (tx) => {
    const workOrder = await tx.bikeWorkOrder.findFirst({
      where: { id: workOrderId, tenantId },
      include: { items: true }
    });
    if (!workOrder) throw new AppError(404, 'Orden Bike no encontrada', 'BIKE_WORK_ORDER_NOT_FOUND');
    if (workOrder.billedAt) throw new AppError(409, 'Una OT facturada no puede cancelarse desde Taller', 'BIKE_BILLED_ORDER_IMMUTABLE');
    if (workOrder.status === 'DELIVERED') throw new AppError(409, 'La OT ya fue entregada', 'BIKE_WORK_ORDER_DELIVERED');

    const executed = workOrder.items.filter((item) => ['IN_PROGRESS', 'COMPLETED', 'INSTALLED'].includes(item.status));
    if (executed.length) {
      throw new AppError(
        409,
        'La OT ya tiene trabajo ejecutado o repuestos instalados. Debe liquidarse o pasar por un flujo de reversión, no cancelarse.',
        'BIKE_WORK_ORDER_CANCEL_REQUIRES_SETTLEMENT',
        { itemIds: executed.map((item) => item.id) }
      );
    }

    await reservations.releaseSourceInTx(tx, tenantId, 'BIKE_WORK_ORDER', workOrder.id, 'CANCELLED');
    await tx.bikeWorkOrderItem.updateMany({
      where: { tenantId, workOrderId, status: { notIn: ['REJECTED', 'CANCELLED'] } },
      data: { status: 'CANCELLED' }
    });
    await tx.bikeWorkOrder.update({
      where: { id: workOrder.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason }
    });
    await tx.bikeAsset.update({ where: { id: workOrder.bikeId }, data: { status: 'ACTIVE' } });

    return tx.bikeWorkOrder.findFirst({
      where: { id: workOrder.id, tenantId },
      include: {
        bike: true,
        items: { include: { service: true }, orderBy: { createdAt: 'asc' } },
        findings: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
        finalTests: { orderBy: { testedAt: 'desc' } }
      }
    });
  });
}

module.exports = { cancelWorkOrderSafe };
