'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const visits = require('./restaurant-visit-payments.service');

const MARKER = 'VANTIX_RESTAURANT_V2_QR_NO_CODE_V11';

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function tableByQr(qrToken, client = prisma) {
  const table = await client.restaurantTable.findUnique({ where:{ qrToken } });
  if (!table || !table.active) throw new AppError(404, 'QR de mesa no encontrado', 'RESTAURANT_QR_NOT_FOUND');
  return table;
}

async function currentSession(table, client = prisma) {
  return client.restaurantTableSession.findFirst({
    where:{ tenantId:table.tenantId, tableId:table.id, state:{ in:['ABIERTA','CUENTA_PEDIDA'] } },
    orderBy:{ openedAt:'desc' }
  });
}

function normalizeSeat(session, seatNumber) {
  const guestCount = Math.max(Number(session.guestCount || 1), 1);
  const seat = Number(seatNumber || 1);
  if (!Number.isInteger(seat) || seat < 1 || seat > guestCount) {
    throw new AppError(400, 'Selecciona una persona válida de esta mesa', 'RESTAURANT_SEAT_INVALID', { guestCount });
  }
  return seat;
}

async function startVisit(qrToken, existingVisitToken = '', seatNumber = 1) {
  const table = await tableByQr(qrToken);

  if (existingVisitToken) {
    try {
      const verified = await visits.verifyVisit(qrToken, existingVisitToken);
      return {
        visitToken:existingVisitToken,
        sessionId:verified.session.id,
        seatNumber:verified.device.seatNumber,
        guestCount:verified.session.guestCount,
        expiresWhenTableCloses:true,
        noCode:true,
        reused:true
      };
    } catch (error) {
      if (!['RESTAURANT_QR_VISIT_INVALID','RESTAURANT_QR_VISIT_REQUIRED','RESTAURANT_QR_TABLE_NOT_OPEN','RESTAURANT_QR_VISIT_SEAT_INVALID'].includes(error.code)) throw error;
    }
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  return prisma.$transaction(async (tx) => {
    const currentTable = await tableByQr(qrToken, tx);
    const session = await currentSession(currentTable, tx);
    if (!session) throw new AppError(409, 'La mesa todavía no está abierta', 'RESTAURANT_QR_TABLE_NOT_OPEN');
    if (session.splitMetadata) throw new AppError(409, 'La cuenta de esta mesa ya está en proceso de cobro', 'RESTAURANT_ACCOUNT_ALREADY_PREPARED');

    const seat = normalizeSeat(session, seatNumber);
    const activeDevices = await tx.restaurantQrVisitDevice.count({
      where:{ tenantId:currentTable.tenantId, sessionId:session.id, revokedAt:null }
    });
    const maxDevices = Math.min(Math.max(Number(session.guestCount || 1) * 2 + 2, 4), 20);
    if (activeDevices >= maxDevices) {
      throw new AppError(429, 'Esta mesa ya tiene demasiados dispositivos activos. Solicita ayuda al mesero.', 'RESTAURANT_QR_VISIT_DEVICE_LIMIT');
    }

    const device = await tx.restaurantQrVisitDevice.create({
      data:{
        tenantId:currentTable.tenantId,
        sessionId:session.id,
        originTableId:currentTable.id,
        tokenHash,
        seatNumber:seat
      }
    });

    return {
      visitToken:rawToken,
      sessionId:session.id,
      seatNumber:device.seatNumber,
      guestCount:session.guestCount,
      expiresWhenTableCloses:true,
      noCode:true,
      reused:false
    };
  });
}

module.exports = { MARKER, startVisit };
