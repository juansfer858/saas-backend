'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const ACTIVE_SESSION_STATES = ['ABIERTA', 'CUENTA_PEDIDA'];
const MARKER = 'VANTIX_RESTAURANT_V2_TABLE_MOVE_P2B';

async function lockTables(tx, tenantId, sourceTableId, destinationTableId) {
  const ids = [sourceTableId, destinationTableId].sort();
  await tx.$queryRawUnsafe(
    'SELECT "id" FROM "RestaurantTable" WHERE "tenantId" = $1 AND "id" IN ($2, $3) ORDER BY "id" FOR UPDATE',
    tenantId,
    ids[0],
    ids[1]
  );
}

async function moveTableVisit(tenantId, user, sourceTableId, destinationTableId) {
  if (!user?.id) throw new AppError(401, 'Se requiere usuario autenticado', 'RESTAURANT_TABLE_MOVE_USER_REQUIRED');
  if (!destinationTableId || destinationTableId === sourceTableId) {
    throw new AppError(400, 'Selecciona una mesa destino diferente', 'RESTAURANT_TABLE_MOVE_DESTINATION_INVALID');
  }

  return prisma.$transaction(async (tx) => {
    await lockTables(tx, tenantId, sourceTableId, destinationTableId);

    const [source, destination] = await Promise.all([
      tx.restaurantTable.findFirst({ where: { id: sourceTableId, tenantId, active: true } }),
      tx.restaurantTable.findFirst({ where: { id: destinationTableId, tenantId, active: true } })
    ]);
    if (!source) throw new AppError(404, 'Mesa de origen no encontrada', 'RESTAURANT_TABLE_MOVE_SOURCE_NOT_FOUND');
    if (!destination) throw new AppError(404, 'Mesa destino no encontrada', 'RESTAURANT_TABLE_MOVE_DESTINATION_NOT_FOUND');

    const session = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId: source.id, state: { in: ACTIVE_SESSION_STATES } },
      include: { table: true }
    });
    if (!session) throw new AppError(409, 'La mesa de origen no tiene una visita activa', 'RESTAURANT_TABLE_MOVE_NO_ACTIVE_VISIT');

    const destinationSession = await tx.restaurantTableSession.findFirst({
      where: { tenantId, tableId: destination.id, state: { in: ACTIVE_SESSION_STATES } },
      select: { id: true }
    });
    if (destinationSession || destination.state !== 'LIBRE') {
      throw new AppError(409, 'La mesa destino debe estar libre', 'RESTAURANT_TABLE_MOVE_DESTINATION_BUSY');
    }

    const sale = await tx.comprobanteComercial.findFirst({
      where: { id: session.saleId, tenantId },
      select: { id: true, estado: true, total: true }
    });
    if (!sale) throw new AppError(409, 'La venta de la visita no está disponible', 'RESTAURANT_TABLE_MOVE_SALE_NOT_FOUND');
    const paymentCount = await tx.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } });
    if (session.splitMetadata || session.accountPreparedAt || session.cashierRequestedAt || paymentCount > 0 || sale.estado !== 'BORRADOR') {
      throw new AppError(409, 'La cuenta ya entró en preparación o cobro y no puede cambiarse de mesa', 'RESTAURANT_TABLE_MOVE_PAYMENT_STARTED');
    }

    // Devices already authorized from the physical source QR keep that immutable origin.
    // This lets an authorized phone follow the same visit after the party changes table,
    // while a new scan of the old QR correctly sees the old physical table as free.
    await tx.restaurantQrVisitDevice.updateMany({
      where: { tenantId, sessionId: session.id, revokedAt: null, originTableId: null },
      data: { originTableId: source.id }
    });

    const accountRequested = Boolean(session.accountRequestedAt || session.state === 'CUENTA_PEDIDA');
    const destinationState = accountRequested ? 'CUENTA_PEDIDA' : 'OCUPADA';

    const moved = await tx.restaurantTableSession.update({
      where: { id: session.id },
      data: { tableId: destination.id },
      include: { table: true }
    });
    await tx.restaurantTable.update({ where: { id: source.id }, data: { state: 'LIBRE' } });
    await tx.restaurantTable.update({ where: { id: destination.id }, data: { state: destinationState } });

    await tx.auditoriaContable.create({
      data: {
        tenant: { connect: { id: tenantId } },
        user: { connect: { id: user.id } },
        entidad: 'RESTAURANT_TABLE_SESSION',
        entidadId: session.id,
        accion: 'MOVE_TABLE',
        metadata: {
          contract: MARKER,
          sourceTableId: source.id,
          sourceTableCode: source.code,
          sourceTableName: source.name,
          destinationTableId: destination.id,
          destinationTableCode: destination.code,
          destinationTableName: destination.name,
          saleId: session.saleId,
          guestCount: session.guestCount,
          accountRequested,
          actorRole: user.rol || null,
          movedAt: new Date().toISOString()
        }
      }
    });

    return {
      marker: MARKER,
      sessionId: moved.id,
      saleId: moved.saleId,
      from: { id: source.id, code: source.code, name: source.name, qrTokenPreserved: true },
      to: { id: destination.id, code: destination.code, name: destination.name, qrTokenPreserved: true },
      state: moved.state,
      tableState: destinationState,
      guestCount: moved.guestCount,
      accountRequested
    };
  });
}

module.exports = { MARKER, moveTableVisit };
