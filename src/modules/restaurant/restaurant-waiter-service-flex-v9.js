'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const identity = require('./restaurant-identity.service');

const MARKER = 'VANTIX_WAITER_FLEXIBLE_BILLING_V9';

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

    const targetMode = input.billingMode || session.billingMode || 'CONJUNTA';
    const targetGuests = input.guestCount !== undefined ? Number(input.guestCount) : Math.max(1, Number(session.guestCount || 1));

    if (input.guestCount !== undefined && orderIds.length && targetMode === 'INDIVIDUAL' && input.billingMode === undefined) {
      const highest = await tx.restaurantOrderItem.aggregate({
        where: { tenantId, orderId: { in: orderIds }, seatNumber: { not: null } },
        _max: { seatNumber: true }
      });
      if (Number(highest._max.seatNumber || 0) > targetGuests) {
        throw new AppError(409, `La Persona ${highest._max.seatNumber} todavía tiene productos. Muévelos antes de reducir el número de personas.`, 'RESTAURANT_GUEST_COUNT_IN_USE');
      }
    }

    const modeChanged = Boolean(input.billingMode && input.billingMode !== session.billingMode);
    if (modeChanged && orderIds.length) {
      await tx.restaurantOrderItem.updateMany({
        where: { tenantId, orderId: { in: orderIds } },
        data: { seatNumber: targetMode === 'INDIVIDUAL' ? 1 : null }
      });
    }

    const data = {};
    if (input.billingMode !== undefined) data.billingMode = input.billingMode;
    if (input.guestCount !== undefined) data.guestCount = input.guestCount;
    return tx.restaurantTableSession.update({ where: { id: session.id }, data, include: { table: true } });
  });

  const draft = await identity.getWaiterDraft(tenantId, user, updated.id);
  return { session: draft.session || updated, service: draft.service };
}

identity.updateTableServiceSetup = updateTableServiceSetupFlexible;

module.exports = { MARKER, updateTableServiceSetupFlexible };
