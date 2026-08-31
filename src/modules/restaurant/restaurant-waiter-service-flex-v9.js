'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const identity = require('./restaurant-identity.service');

const MARKER = 'VANTIX_WAITER_FLEXIBLE_BILLING_V10';

async function updateTableServiceSetupFlexible(tenantId, user, sessionId, input) {
  const updated = await prisma.$transaction(async (tx) => {
    const session = await tx.restaurantTableSession.findFirst({
      where: { id: sessionId, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      include: { table: true }
    });
    if (!session) throw new AppError(404, 'Sesión de mesa abierta no encontrada', 'RESTAURANT_SESSION_NOT_FOUND');

    const orderIds = (await tx.restaurantOrder.findMany({
      where: { tenantId, sessionId: session.id, state: { not: 'CANCELADO' } },
      select: { id: true }
    })).map((row) => row.id);

    const currentGuests = Math.max(1, Number(session.guestCount || 1));
    const targetMode = input.billingMode || session.billingMode || 'CONJUNTA';
    const targetGuests = input.guestCount !== undefined ? Math.max(1, Number(input.guestCount)) : currentGuests;
    const modeChanged = Boolean(input.billingMode && input.billingMode !== session.billingMode);

    if (modeChanged && orderIds.length) {
      await tx.restaurantOrderItem.updateMany({
        where: { tenantId, orderId: { in: orderIds } },
        data: { seatNumber: targetMode === 'INDIVIDUAL' ? 1 : null }
      });
    } else if (targetMode === 'INDIVIDUAL' && targetGuests < currentGuests && orderIds.length) {
      // Al eliminar personas nunca se pierden consumos: cualquier ítem de una persona
      // que desaparece se fusiona en la última persona que queda visible.
      await tx.restaurantOrderItem.updateMany({
        where: {
          tenantId,
          orderId: { in: orderIds },
          seatNumber: { gt: targetGuests }
        },
        data: { seatNumber: targetGuests }
      });
    }

    const data = {};
    if (input.billingMode !== undefined) data.billingMode = input.billingMode;
    if (input.guestCount !== undefined) data.guestCount = targetGuests;
    return tx.restaurantTableSession.update({ where: { id: session.id }, data, include: { table: true } });
  });

  const draft = await identity.getWaiterDraft(tenantId, user, updated.id);
  return { session: draft.session || updated, service: draft.service };
}

identity.updateTableServiceSetup = updateTableServiceSetupFlexible;

module.exports = { MARKER, updateTableServiceSetupFlexible };
