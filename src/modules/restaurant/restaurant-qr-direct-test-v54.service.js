'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const DIRECT_TEST_MODE = 'RESTAURANT_QR_DIRECT_TEST_V54';

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeSeat(session, seatNumber) {
  const guestCount = Math.max(Number(session.guestCount || 1), 1);
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > guestCount) {
    throw new AppError(400, 'Selecciona una persona válida de esta mesa', 'RESTAURANT_SEAT_INVALID', { guestCount });
  }
  return seat;
}

async function authorizeDirectVisit(qrToken, seatNumber = 1) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findUnique({ where: { qrToken } });
    if (!table || !table.active) {
      throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
    }

    const session = await tx.restaurantTableSession.findFirst({
      where: {
        tenantId: table.tenantId,
        tableId: table.id,
        state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] }
      },
      orderBy: { openedAt: 'desc' }
    });
    if (!session) {
      throw new AppError(409, 'La mesa todavía no está abierta', 'RESTAURANT_QR_TABLE_NOT_OPEN');
    }
    if (session.splitMetadata) {
      throw new AppError(409, 'La cuenta de esta mesa ya está en proceso de cobro', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');
    }

    const activeDevices = await tx.restaurantQrVisitDevice.count({
      where: { tenantId: table.tenantId, sessionId: session.id, revokedAt: null }
    });
    const maxDevices = Math.min(Math.max(Number(session.guestCount || 1) * 2 + 2, 4), 20);
    if (activeDevices >= maxDevices) {
      throw new AppError(429, 'Esta mesa ya tiene demasiados teléfonos activos. Cierra y vuelve a abrir la mesa para reiniciar la prueba.', 'RESTAURANT_QR_VISIT_DEVICE_LIMIT');
    }

    const seat = normalizeSeat(session, seatNumber);
    const device = await tx.restaurantQrVisitDevice.create({
      data: {
        tenantId: table.tenantId,
        sessionId: session.id,
        tokenHash,
        seatNumber: seat
      }
    });

    // V54 sólo elimina el PIN de cuatro dígitos. Conservamos sesión de mesa,
    // límites, trazabilidad por dispositivo y bloqueo cuando la cuenta entra a cobro.
    await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: { qrVisitFailedAttempts: 0, qrVisitLockedUntil: null }
    });

    return {
      visitToken: rawToken,
      sessionId: session.id,
      seatNumber: device.seatNumber,
      guestCount: session.guestCount,
      expiresWhenTableCloses: true,
      authorization: 'DIRECT_TEST',
      mode: DIRECT_TEST_MODE
    };
  });
}

module.exports = {
  DIRECT_TEST_MODE,
  authorizeDirectVisit
};
